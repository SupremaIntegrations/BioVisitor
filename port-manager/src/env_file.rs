//! Lectura/escritura del `.env` del backend preservando byte a byte todo
//! lo que no se toca (comentarios, orden de claves, terminadores de línea
//! CRLF) — equivalente Rust de `ReadEnvValue`/`PatchBackendEnvForUpgrade`
//! en windows-deployment/setup/biovisitor-setup.iss, pero reutilizable
//! desde la UI para cualquier clave.

use crate::model::{AppError, AppResult};
use std::fs;
use std::path::Path;

pub struct EnvFile {
    /// Cada línea SIN su terminador. `had_trailing_newline` recuerda si el
    /// archivo original terminaba en un salto de línea, para no
    /// agregar/quitar uno al guardar.
    lines: Vec<String>,
    had_trailing_newline: bool,
}

impl EnvFile {
    pub fn load(path: &Path) -> AppResult<Self> {
        let bytes = fs::read(path)
            .map_err(|e| AppError::EnvFile(format!("no se pudo leer {}: {e}", path.display())))?;
        let text = String::from_utf8_lossy(&bytes).into_owned();

        // CRLF explícito: NO usar str::lines(), que también partiría en
        // solitario "\n" y perdería la distinción, silenciosamente
        // convirtiendo el archivo entero a LF al reescribirlo.
        let had_trailing_newline = text.ends_with("\r\n") || text.ends_with('\n');
        let normalized = text.replace("\r\n", "\n");
        let lines: Vec<String> = normalized
            .split('\n')
            .map(|s| s.to_string())
            .collect();
        // split('\n') deja un elemento vacío final si el texto terminaba
        // en salto de línea — se descarta aquí y se reconstruye al guardar
        // según had_trailing_newline.
        let lines = if had_trailing_newline && lines.last().is_some_and(|l| l.is_empty()) {
            lines[..lines.len() - 1].to_vec()
        } else {
            lines
        };

        Ok(Self {
            lines,
            had_trailing_newline,
        })
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        let prefix = format!("{key}=");
        self.lines
            .iter()
            .find_map(|l| l.strip_prefix(prefix.as_str()))
    }

    pub fn get_u16(&self, key: &str) -> Option<u16> {
        self.get(key).and_then(|v| v.trim().parse().ok())
    }

    /// Reemplaza la línea `KEY=...` existente (conservando su posición) o,
    /// si la clave no existe, agrega una línea nueva al final.
    pub fn set(&mut self, key: &str, value: &str) {
        let prefix = format!("{key}=");
        let new_line = format!("{key}={value}");
        if let Some(line) = self
            .lines
            .iter_mut()
            .find(|l| l.starts_with(prefix.as_str()))
        {
            *line = new_line;
        } else {
            self.lines.push(new_line);
        }
    }

    pub fn save(&self, path: &Path) -> AppResult<()> {
        let mut out = self.lines.join("\r\n");
        if self.had_trailing_newline {
            out.push_str("\r\n");
        }

        // Escribir a un archivo temporal en el mismo directorio y luego
        // renombrar, para no dejar un .env truncado si el proceso muere a
        // mitad de la escritura (el backend depende de este archivo para
        // arrancar).
        let tmp_path = path.with_extension("env.tmp");
        fs::write(&tmp_path, out.as_bytes()).map_err(|e| {
            AppError::EnvFile(format!(
                "no se pudo escribir {}: {e}",
                tmp_path.display()
            ))
        })?;
        fs::rename(&tmp_path, path).map_err(|e| {
            AppError::EnvFile(format!(
                "no se pudo reemplazar {}: {e}",
                path.display()
            ))
        })?;
        Ok(())
    }
}

pub fn get_backend_port(env_path: &Path) -> AppResult<u16> {
    Ok(EnvFile::load(env_path)?.get_u16("APP_PORT").unwrap_or(3001))
}

pub fn set_backend_port(env_path: &Path, new_port: u16) -> AppResult<()> {
    let mut f = EnvFile::load(env_path)?;
    f.set("APP_PORT", &new_port.to_string());
    f.save(env_path)
}

/// Puertos de PostgreSQL/Redis tal como el backend los usa para
/// CONECTARSE (no necesariamente el puerto de escucha real, aunque en la
/// práctica deben coincidir). `db_port` es editable desde el panel de
/// Puertos (junto con `postgres_conf::set_port`); `redis_port` se muestra
/// solo como referencia de diagnóstico.
pub struct DiagnosticPorts {
    pub db_port: Option<u16>,
    pub redis_port: Option<u16>,
}

pub fn get_diagnostic_ports(env_path: &Path) -> AppResult<DiagnosticPorts> {
    let f = EnvFile::load(env_path)?;
    Ok(DiagnosticPorts {
        db_port: f.get_u16("DB_PORT"),
        redis_port: f.get_u16("REDIS_PORT"),
    })
}

pub fn set_db_port(env_path: &Path, new_port: u16) -> AppResult<()> {
    let mut f = EnvFile::load(env_path)?;
    f.set("DB_PORT", &new_port.to_string());
    f.save(env_path)
}

pub fn get_encryption_master_key(env_path: &Path) -> AppResult<Option<String>> {
    Ok(EnvFile::load(env_path)?
        .get("ENCRYPTION_MASTER_KEY")
        .map(|s| s.to_string()))
}

/// Busca `KEY=valor` en un texto de `.env` ya cargado en memoria (por
/// ejemplo, extraído de un backup sin escribirlo a disco todavía). Usado
/// para comparar `ENCRYPTION_MASTER_KEY` entre el backup y la instalación
/// actual antes de decidir si restaurar el `.env` junto con la base de
/// datos.
pub fn key_from_text(text: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}=");
    text.lines()
        .find_map(|l| l.strip_prefix(prefix.as_str()))
        .map(|v| v.trim_end_matches('\r').to_string())
}
