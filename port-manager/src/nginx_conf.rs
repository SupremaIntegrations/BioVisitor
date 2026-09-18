//! Ubicación y edición de `nginx.conf` — el frontend ya no es un proceso
//! Node.js configurado por variables de entorno de NSSM
//! (`AppEnvironmentExtra`), es nginx sirviendo la SPA estática y haciendo
//! de proxy al backend (ver windows-deployment/assets/nginx.conf.template).
//! Sus puertos viven como directivas `listen` dentro de este archivo.
//! Mismo patrón de patch-preservando-el-resto-del-archivo que
//! `postgres_conf.rs`.

use crate::model::{AppError, AppResult};
use std::fs;
use std::path::{Path, PathBuf};

pub fn conf_path(install_dir: &Path) -> PathBuf {
    install_dir.join("nginx").join("conf").join("nginx.conf")
}

pub struct FrontendPorts {
    pub https: Option<u16>,
    pub http: Option<u16>,
}

fn is_https_listen(trimmed: &str) -> bool {
    trimmed.starts_with("listen ") && trimmed.trim_end().trim_end_matches(';').ends_with("ssl")
}

fn is_http_listen(trimmed: &str) -> bool {
    trimmed.starts_with("listen ") && !trimmed.contains("ssl")
}

fn parse_listen_port(trimmed: &str) -> Option<u16> {
    // "listen 443 ssl;" -> "443 ssl;" -> "443"
    let rest = trimmed.strip_prefix("listen ")?;
    let first_token = rest.split_whitespace().next()?;
    first_token.trim_end_matches(';').parse().ok()
}

pub fn get_ports(conf_path: &Path) -> AppResult<FrontendPorts> {
    let text = fs::read_to_string(conf_path)
        .map_err(|e| AppError::EnvFile(format!("no se pudo leer {}: {e}", conf_path.display())))?;

    let mut https = None;
    let mut http = None;
    for line in text.lines() {
        let trimmed = line.trim_start();
        if is_https_listen(trimmed) {
            https = parse_listen_port(trimmed);
        } else if is_http_listen(trimmed) {
            http = parse_listen_port(trimmed);
        }
    }
    Ok(FrontendPorts { https, http })
}

/// Cambia el puerto HTTPS: la directiva `listen ... ssl;` del server block
/// principal, Y el destino del redirect 301 del server block HTTP (que
/// apunta al puerto HTTPS) — si solo se cambiara la primera, el redirect
/// automático HTTP→HTTPS quedaría apuntando al puerto viejo.
pub fn set_https_port(conf_path: &Path, new_port: u16) -> AppResult<()> {
    patch_conf(conf_path, |trimmed, indent| {
        if is_https_listen(trimmed) {
            Some(format!("{indent}listen {new_port} ssl;"))
        } else if trimmed.trim_start().starts_with("return 301 https://") {
            Some(format!("{indent}return 301 https://$host:{new_port}$request_uri;"))
        } else {
            None
        }
    })
}

pub fn set_http_port(conf_path: &Path, new_port: u16) -> AppResult<()> {
    patch_conf(conf_path, |trimmed, indent| {
        if is_http_listen(trimmed) {
            Some(format!("{indent}listen {new_port};"))
        } else {
            None
        }
    })
}

fn patch_conf(
    conf_path: &Path,
    replace: impl Fn(&str, &str) -> Option<String>,
) -> AppResult<()> {
    let text = fs::read_to_string(conf_path)
        .map_err(|e| AppError::EnvFile(format!("no se pudo leer {}: {e}", conf_path.display())))?;
    let had_trailing_newline = text.ends_with('\n');

    let mut out_lines: Vec<String> = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim_start();
        let indent = &line[..line.len() - trimmed.len()];
        match replace(trimmed, indent) {
            Some(new_line) => out_lines.push(new_line),
            None => out_lines.push(line.to_string()),
        }
    }

    let mut out = out_lines.join("\n");
    if had_trailing_newline {
        out.push('\n');
    }

    let tmp_path = conf_path.with_extension("conf.tmp");
    fs::write(&tmp_path, out.as_bytes())
        .map_err(|e| AppError::EnvFile(format!("no se pudo escribir {}: {e}", tmp_path.display())))?;
    fs::rename(&tmp_path, conf_path)
        .map_err(|e| AppError::EnvFile(format!("no se pudo reemplazar {}: {e}", conf_path.display())))?;
    Ok(())
}
