//! Backup y restauración completos: no solo la base de datos.
//!
//! Un backup "completo" de BioVisitor necesita 4 cosas, no solo el dump
//! de PostgreSQL:
//!   1. `db.dump`        — pg_dump en formato custom (-Fc)
//!   2. `backend.env`    — CRÍTICO: contiene ENCRYPTION_MASTER_KEY, la
//!                         clave AES-256-GCM con la que están cifradas las
//!                         credenciales de BioStar en la base de datos. Un
//!                         backup de la BD sin su .env correspondiente es
//!                         inútil para todo lo que dependa de esas
//!                         credenciales tras restaurar.
//!   3. `uploads/**`     — fotos de visitantes, viven en disco, no en la BD
//!   4. `cert/**`        — certificado SSL autofirmado de 7 años
//!
//! Todo el archivo va cifrado con AES-256 (contraseña elegida por el
//! admin) porque contiene secretos en texto plano y datos de visitantes —
//! está pensado para copiarse fuera del servidor.

use crate::env_file::EnvFile;
use crate::model::{AppError, AppResult};
use crate::postgres_tools;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{AesMode, ZipArchive, ZipWriter};

const MANIFEST_NAME: &str = "manifest.json";
const DUMP_NAME: &str = "db.dump";
const ENV_NAME: &str = "backend.env";

fn uploads_dir(install_dir: &Path) -> PathBuf {
    install_dir.join("backend").join("uploads")
}
fn cert_dir(install_dir: &Path) -> PathBuf {
    install_dir.join("frontend").join("cert")
}
fn backend_env_path(install_dir: &Path) -> PathBuf {
    install_dir.join("backend").join(".env")
}
fn db_dump_tmp_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "biovisitor-restore-{}.dump",
        std::process::id()
    ))
}

fn read_db_creds(install_dir: &Path) -> AppResult<(String, u16)> {
    let env = EnvFile::load(&backend_env_path(install_dir))?;
    let password = env.get("DB_PASSWORD").unwrap_or("").to_string();
    let port = env.get_u16("DB_PORT").unwrap_or(55432);
    Ok((password, port))
}

fn run_checked(cmd: &mut std::process::Command, what: &str) -> AppResult<()> {
    let output = cmd
        .output()
        .map_err(|e| AppError::Other(format!("no se pudo ejecutar {what}: {e}")))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "{what} falló (código {:?}): {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr)
        )))
    }
}

fn add_dir_to_zip(
    zip: &mut ZipWriter<File>,
    dir: &Path,
    zip_prefix: &str,
    options: zip::write::FileOptions<'_, ()>,
) -> AppResult<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry
            .path()
            .strip_prefix(dir)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        let zip_name = format!("{zip_prefix}/{rel}");

        zip.start_file(&zip_name, options)
            .map_err(|e| AppError::Other(format!("no se pudo agregar {zip_name} al backup: {e}")))?;
        let mut f = File::open(entry.path())
            .map_err(|e| AppError::Other(format!("no se pudo leer {}: {e}", entry.path().display())))?;
        std::io::copy(&mut f, zip)
            .map_err(|e| AppError::Other(format!("no se pudo copiar {zip_name} al backup: {e}")))?;
    }
    Ok(())
}

pub struct BackupOptions<'a> {
    pub install_dir: &'a Path,
    pub dest_dir: &'a Path,
    pub archive_password: &'a str,
}

/// Crea un backup completo y devuelve la ruta del archivo generado.
pub fn create_backup(opts: &BackupOptions) -> AppResult<PathBuf> {
    let (db_password, db_port) = read_db_creds(opts.install_dir)?;

    let pg_dump = postgres_tools::pg_dump_exe()
        .ok_or_else(|| AppError::Other("no se encontró pg_dump.exe".to_string()))?;
    let tmp_dump = db_dump_tmp_path();

    run_checked(
        std::process::Command::new(&pg_dump)
            .env("PGPASSWORD", &db_password)
            .args([
                "-U",
                "postgres",
                "-h",
                "127.0.0.1",
                "-p",
                &db_port.to_string(),
                "-F",
                "c",
                "-f",
            ])
            .arg(&tmp_dump)
            .arg("biovisitor_db"),
        "pg_dump",
    )?;

    std::fs::create_dir_all(opts.dest_dir)
        .map_err(|e| AppError::Other(format!("no se pudo crear {}: {e}", opts.dest_dir.display())))?;

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H%M%S");
    let archive_path = opts.dest_dir.join(format!("BioVisitor-Backup-{timestamp}.zip"));

    let file = File::create(&archive_path)
        .map_err(|e| AppError::Other(format!("no se pudo crear {}: {e}", archive_path.display())))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().with_aes_encryption(AesMode::Aes256, opts.archive_password);

    let manifest = format!(
        "{{\"created_at\":\"{}\",\"tool_version\":\"{}\"}}",
        chrono::Local::now().to_rfc3339(),
        env!("CARGO_PKG_VERSION")
    );
    zip.start_file(MANIFEST_NAME, options)
        .map_err(|e| AppError::Other(e.to_string()))?;
    zip.write_all(manifest.as_bytes())
        .map_err(|e| AppError::Other(e.to_string()))?;

    zip.start_file(DUMP_NAME, options)
        .map_err(|e| AppError::Other(e.to_string()))?;
    {
        let mut f = File::open(&tmp_dump)
            .map_err(|e| AppError::Other(format!("no se pudo leer el dump temporal: {e}")))?;
        std::io::copy(&mut f, &mut zip).map_err(|e| AppError::Other(e.to_string()))?;
    }

    zip.start_file(ENV_NAME, options)
        .map_err(|e| AppError::Other(e.to_string()))?;
    {
        let bytes = std::fs::read(backend_env_path(opts.install_dir))
            .map_err(|e| AppError::Other(format!("no se pudo leer backend\\.env: {e}")))?;
        zip.write_all(&bytes).map_err(|e| AppError::Other(e.to_string()))?;
    }

    add_dir_to_zip(&mut zip, &uploads_dir(opts.install_dir), "uploads", options)?;
    add_dir_to_zip(&mut zip, &cert_dir(opts.install_dir), "cert", options)?;

    zip.finish().map_err(|e| AppError::Other(e.to_string()))?;
    let _ = std::fs::remove_file(&tmp_dump);

    Ok(archive_path)
}

/// Extrae y devuelve el contenido de `backend.env` DENTRO del backup, sin
/// restaurar nada todavía — se usa para comparar `ENCRYPTION_MASTER_KEY`
/// contra la instalación actual antes de que el admin confirme la
/// restauración.
pub fn peek_archive_env(archive_path: &Path, password: &str) -> AppResult<String> {
    let file = File::open(archive_path)
        .map_err(|e| AppError::Other(format!("no se pudo abrir el backup: {e}")))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| AppError::Other(format!("archivo de backup inválido: {e}")))?;
    let mut entry = archive
        .by_name_decrypt(ENV_NAME, password.as_bytes())
        .map_err(|e| AppError::Other(format!("no se pudo leer {ENV_NAME} del backup (¿contraseña incorrecta?): {e}")))?;
    let mut content = String::new();
    entry
        .read_to_string(&mut content)
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(content)
}

pub struct RestoreOptions<'a> {
    pub install_dir: &'a Path,
    pub archive_path: &'a Path,
    pub archive_password: &'a str,
    /// Si es false, se restauran BD/uploads/cert pero se conserva el
    /// backend\.env actualmente instalado (útil cuando el admin ya
    /// verificó que las claves coinciden y no quiere tocar configuración
    /// que pudo haber cambiado desde el backup, p. ej. puertos).
    pub restore_env: bool,
}

pub fn restore_backup(opts: &RestoreOptions) -> AppResult<()> {
    let file = File::open(opts.archive_path)
        .map_err(|e| AppError::Other(format!("no se pudo abrir el backup: {e}")))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| AppError::Other(format!("archivo de backup inválido: {e}")))?;

    let tmp_dump = db_dump_tmp_path();
    {
        let mut entry = archive
            .by_name_decrypt(DUMP_NAME, opts.archive_password.as_bytes())
            .map_err(|e| AppError::Other(format!("no se pudo leer {DUMP_NAME} (¿contraseña incorrecta?): {e}")))?;
        let mut out = File::create(&tmp_dump).map_err(|e| AppError::Other(e.to_string()))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| AppError::Other(e.to_string()))?;
    }

    if opts.restore_env {
        let mut entry = archive
            .by_name_decrypt(ENV_NAME, opts.archive_password.as_bytes())
            .map_err(|e| AppError::Other(e.to_string()))?;
        let mut out = File::create(backend_env_path(opts.install_dir)).map_err(|e| AppError::Other(e.to_string()))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| AppError::Other(e.to_string()))?;
    }

    // uploads/ y cert/: recorrer todas las entradas y extraer las que
    // empiecen con esos prefijos. Se sobreescribe todo — semántica de
    // "restaurar al punto del backup", no de fusionar.
    let count = archive.len();
    for i in 0..count {
        let mut entry = archive
            .by_index_decrypt(i, opts.archive_password.as_bytes())
            .map_err(|e| AppError::Other(e.to_string()))?;
        let name = entry.name().to_string();

        let dest = if let Some(rel) = name.strip_prefix("uploads/") {
            Some(uploads_dir(opts.install_dir).join(rel))
        } else if let Some(rel) = name.strip_prefix("cert/") {
            Some(cert_dir(opts.install_dir).join(rel))
        } else {
            None
        };

        if let Some(dest) = dest {
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).map_err(|e| AppError::Other(e.to_string()))?;
            }
            let mut out = File::create(&dest)
                .map_err(|e| AppError::Other(format!("no se pudo escribir {}: {e}", dest.display())))?;
            std::io::copy(&mut entry, &mut out).map_err(|e| AppError::Other(e.to_string()))?;
        }
    }
    drop(archive);

    let (db_password, db_port) = read_db_creds(opts.install_dir)?;
    let pg_restore = postgres_tools::pg_restore_exe()
        .ok_or_else(|| AppError::Other("no se encontró pg_restore.exe".to_string()))?;

    run_checked(
        std::process::Command::new(&pg_restore)
            .env("PGPASSWORD", &db_password)
            .args([
                "-U",
                "postgres",
                "-h",
                "127.0.0.1",
                "-p",
                &db_port.to_string(),
                "-d",
                "biovisitor_db",
                "--clean",
                "--if-exists",
            ])
            .arg(&tmp_dump),
        "pg_restore",
    )?;

    let _ = std::fs::remove_file(&tmp_dump);
    Ok(())
}
