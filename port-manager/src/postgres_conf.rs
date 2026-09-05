//! Ubicación y edición de `postgresql.conf` — el puerto real de escucha de
//! "BioVisitor Database Service" vive ahí, no solo en el `.env` del
//! backend. Mismo patrón de búsqueda de rutas que `FindPgBin` en
//! biovisitor-setup.iss (probar versiones 16/15/14 bajo el directorio
//! estándar de EDB), y mismo estilo de patch-una-línea que `env_file.rs`.

use crate::model::{AppError, AppResult};
use std::fs;
use std::path::{Path, PathBuf};

const PG_VERSIONS: [&str; 3] = ["16", "15", "14"];

pub fn find_pg_root() -> Option<PathBuf> {
    for version in PG_VERSIONS {
        let candidate = PathBuf::from(format!(r"C:\Program Files\PostgreSQL\{version}"));
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    None
}

pub fn find_bin_dir() -> Option<PathBuf> {
    find_pg_root().map(|root| root.join("bin"))
}

/// Directorio de datos por defecto de una instalación unattended del
/// instalador EDB (que es como biovisitor-setup.iss instala PostgreSQL) —
/// `{root}\data`. Si un administrador movió los datos a otra ruta a mano,
/// esta detección fallará y la UI debe permitir indicarla manualmente
/// (ver Settings panel).
pub fn find_conf_path() -> Option<PathBuf> {
    let root = find_pg_root()?;
    let conf = root.join("data").join("postgresql.conf");
    conf.is_file().then_some(conf)
}

pub fn get_port(conf_path: &Path) -> AppResult<u16> {
    let text = fs::read_to_string(conf_path)
        .map_err(|e| AppError::EnvFile(format!("no se pudo leer {}: {e}", conf_path.display())))?;
    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("port") {
            let rest = rest.trim_start();
            if let Some(rest) = rest.strip_prefix('=') {
                // El valor puede llevar un comentario a la derecha:
                // "port = 55432   # comentario"
                let value = rest
                    .trim()
                    .split_whitespace()
                    .next()
                    .unwrap_or("");
                if let Ok(port) = value.parse::<u16>() {
                    return Ok(port);
                }
            }
        }
    }
    Err(AppError::EnvFile(format!(
        "no se encontró una línea \"port = \" válida en {}",
        conf_path.display()
    )))
}

/// Reemplaza la línea `port = X` existente por el nuevo valor, preservando
/// el resto del archivo (incluido cualquier comentario en la misma línea
/// después del valor). No agrega la línea si no existe — postgresql.conf
/// siempre trae esa directiva (comentada o no) en una instalación EDB
/// estándar; si falta, es una instalación no estándar y se prefiere
/// fallar explícitamente antes que adivinar dónde insertarla.
pub fn set_port(conf_path: &Path, new_port: u16) -> AppResult<()> {
    let text = fs::read_to_string(conf_path)
        .map_err(|e| AppError::EnvFile(format!("no se pudo leer {}: {e}", conf_path.display())))?;
    let had_trailing_newline = text.ends_with('\n');

    let mut found = false;
    let mut out_lines: Vec<String> = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim_start();
        let is_port_directive = !trimmed.starts_with('#')
            && trimmed
                .strip_prefix("port")
                .map(|r| r.trim_start().starts_with('='))
                .unwrap_or(false);

        if is_port_directive && !found {
            found = true;
            out_lines.push(format!("port = {new_port}"));
        } else {
            out_lines.push(line.to_string());
        }
    }

    if !found {
        return Err(AppError::EnvFile(format!(
            "no se encontró una línea \"port = \" para reemplazar en {}",
            conf_path.display()
        )));
    }

    let mut out = out_lines.join("\n");
    if had_trailing_newline {
        out.push('\n');
    }

    let tmp_path = conf_path.with_extension("conf.tmp");
    fs::write(&tmp_path, out.as_bytes()).map_err(|e| {
        AppError::EnvFile(format!("no se pudo escribir {}: {e}", tmp_path.display()))
    })?;
    fs::rename(&tmp_path, conf_path).map_err(|e| {
        AppError::EnvFile(format!(
            "no se pudo reemplazar {}: {e}",
            conf_path.display()
        ))
    })?;
    Ok(())
}
