//! Wrapper para invocar nssm.exe — usado ÚNICAMENTE para cambiar
//! `AppEnvironmentExtra` del servicio frontend (PORT/HTTP_PORT/
//! NEXT_INTERNAL_PORT), el único parámetro que el Service Control Manager
//! nativo no expone. Todo lo demás (start/stop/restart/status, de
//! cualquiera de los 4 servicios) pasa por `service_control`, que
//! funciona sin depender de NSSM.

use crate::model::{AppError, AppResult};
use std::path::Path;
use std::process::Command;
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

pub fn nssm_path(install_dir: &Path) -> std::path::PathBuf {
    install_dir.join("tools").join("nssm.exe")
}

fn run(nssm: &Path, args: &[&str]) -> AppResult<()> {
    let output = Command::new(nssm).args(args).output().map_err(|e| {
        AppError::Other(format!("no se pudo ejecutar {}: {e}", nssm.display()))
    })?;

    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::Nssm {
            exit_code: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

/// Reemplaza TODO el conjunto de variables `AppEnvironmentExtra` del
/// servicio — NSSM no soporta parchear una sola variable, siempre
/// reemplaza la lista completa, así que el llamador debe volver a pasar
/// también los valores que no cambiaron.
pub fn set_app_environment_extra(nssm: &Path, service: &str, vars: &[(&str, &str)]) -> AppResult<()> {
    let mut args: Vec<String> = vec!["set".to_string(), service.to_string(), "AppEnvironmentExtra".to_string()];
    for (k, v) in vars {
        args.push(format!("{k}={v}"));
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run(nssm, &arg_refs)
}

/// Lee `AppEnvironmentExtra` directamente del registro (más simple y
/// confiable que invocar `nssm get` y parsear su salida de texto). NSSM
/// guarda esto como REG_MULTI_SZ bajo los parámetros propios del
/// servicio, no bajo la clave estándar del servicio.
fn read_app_environment_extra(service: &str) -> Vec<String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let path = format!(r"SYSTEM\CurrentControlSet\Services\{service}\Parameters");
    hklm.open_subkey(path)
        .and_then(|k| k.get_value::<Vec<String>, _>("AppEnvironmentExtra"))
        .unwrap_or_default()
}

/// Puertos actuales del frontend (HTTPS, HTTP, interno) tal como están
/// configurados HOY en el servicio — usado para prellenar el panel de
/// Puertos antes de cualquier edición.
pub fn get_frontend_ports(service: &str) -> (Option<u16>, Option<u16>, Option<u16>) {
    let mut https = None;
    let mut http = None;
    let mut internal = None;
    for entry in read_app_environment_extra(service) {
        if let Some((key, value)) = entry.split_once('=') {
            match key {
                "PORT" => https = value.parse().ok(),
                "HTTP_PORT" => http = value.parse().ok(),
                "NEXT_INTERNAL_PORT" => internal = value.parse().ok(),
                _ => {}
            }
        }
    }
    (https, http, internal)
}
