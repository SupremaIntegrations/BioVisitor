use std::path::{Path, PathBuf};
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

/// GUID fijo del producto — debe coincidir EXACTAMENTE con `AppIdGuid` en
/// windows-deployment/setup/biovisitor-setup.iss. Inno Setup siempre
/// escribe esta clave de desinstalación y, dentro de ella, un valor
/// llamado "Inno Setup: App Path" con el directorio real de instalación.
const UNINSTALL_KEY: &str =
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{A9E9D1B4-6C3E-4B8F-9A1D-5F2E7C8B0A31}_is1";

const DEFAULT_INSTALL_DIR: &str = r"C:\Program Files\SupremaLATAM\BioVisitor";

/// Intenta ubicar el directorio de instalación leyendo la clave de
/// desinstalación que dejó el instalador Inno Setup. Si no existe (por
/// ejemplo, en una máquina de desarrollo sin instalación real), cae al
/// directorio por defecto — el llamador decide si eso es válido
/// comprobando que exista `backend\.env` dentro.
pub fn detect() -> PathBuf {
    if let Some(dir) = read_from_registry() {
        return dir;
    }
    PathBuf::from(DEFAULT_INSTALL_DIR)
}

fn read_from_registry() -> Option<PathBuf> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm.open_subkey(UNINSTALL_KEY).ok()?;
    let path: String = key.get_value("Inno Setup: App Path").ok()?;
    if path.is_empty() {
        return None;
    }
    let path = PathBuf::from(path);
    path.is_dir().then_some(path)
}

/// Comprobación mínima de que un directorio "parece" una instalación real
/// de BioVisitor — usada tanto al autodetectar como al validar una ruta
/// que el usuario eligió manualmente en Configuración.
pub fn looks_like_install_dir(dir: &Path) -> bool {
    dir.join("backend").join(".env").is_file()
}
