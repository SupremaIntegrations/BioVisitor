//! Bitácora de auditoría en texto plano — quién hizo qué y cuándo. Mismo
//! espíritu que `LogInstallStep` en biovisitor-setup.iss: una línea por
//! acción, sin necesidad de un framework de logging para una herramienta
//! de un puñado de acciones por sesión.

use crate::config::audit_log_path;
use std::fs::OpenOptions;
use std::io::Write;

fn current_user() -> String {
    std::env::var("USERNAME").unwrap_or_else(|_| "desconocido".to_string())
}

pub fn record(action: &str, detail: &str, result: &str) {
    let path = audit_log_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }

    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let line = format!(
        "{timestamp}  [user: {}]  ACTION={action} {detail} RESULT={result}\r\n",
        current_user()
    );

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(line.as_bytes());
    }
}
