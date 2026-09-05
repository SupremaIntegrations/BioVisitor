//! Configuración propia de la aplicación — directorio de instalación y
//! nombre del servicio de Redis, ambos con detección automática pero
//! sobreescribibles a mano desde el panel de Configuración. Se guarda a
//! nivel de máquina (ProgramData, no AppData) porque el programa corre
//! elevado y cualquier administrador debería ver la misma configuración.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::{install_dir, service_discovery};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub install_dir_override: Option<PathBuf>,
    pub redis_service_override: Option<String>,
}

fn config_dir() -> PathBuf {
    let program_data =
        std::env::var("PROGRAMDATA").unwrap_or_else(|_| r"C:\ProgramData".to_string());
    PathBuf::from(program_data).join("SupremaLATAM").join("BioVisitor")
}

fn config_path() -> PathBuf {
    config_dir().join("port-manager-config.json")
}

impl AppConfig {
    pub fn load() -> Self {
        let path = config_path();
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) -> std::io::Result<()> {
        let dir = config_dir();
        std::fs::create_dir_all(&dir)?;
        let json = serde_json::to_string_pretty(self).unwrap_or_default();
        std::fs::write(config_path(), json)
    }

    /// Directorio de instalación efectivo: override manual si hay uno y es
    /// válido, si no la detección automática vía registro.
    pub fn resolve_install_dir(&self) -> PathBuf {
        if let Some(dir) = &self.install_dir_override {
            if install_dir::looks_like_install_dir(dir) {
                return dir.clone();
            }
        }
        install_dir::detect()
    }

    /// Nombre de servicio de Redis efectivo: override manual si hay uno,
    /// si no la última detección automática guardada, si no el nombre por
    /// defecto del instalador MSI de tporadowski ("Redis").
    pub fn resolve_redis_service(&self) -> String {
        self.redis_service_override
            .clone()
            .or_else(service_discovery::find_redis_service)
            .unwrap_or_else(|| "Redis".to_string())
    }

    pub fn set_install_dir_override(&mut self, dir: Option<PathBuf>) {
        self.install_dir_override = dir;
    }

    pub fn set_redis_service_override(&mut self, name: Option<String>) {
        self.redis_service_override = name;
    }
}

pub fn audit_log_path() -> PathBuf {
    config_dir().join("port-manager-audit.log")
}

pub fn is_valid_install_dir(dir: &Path) -> bool {
    install_dir::looks_like_install_dir(dir)
}
