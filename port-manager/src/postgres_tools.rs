//! Ubicación de pg_dump.exe / pg_restore.exe / psql.exe — mismo directorio
//! `bin` que `postgres_conf::find_bin_dir`.

use std::path::PathBuf;

pub fn pg_dump_exe() -> Option<PathBuf> {
    crate::postgres_conf::find_bin_dir().map(|d| d.join("pg_dump.exe"))
}

pub fn pg_restore_exe() -> Option<PathBuf> {
    crate::postgres_conf::find_bin_dir().map(|d| d.join("pg_restore.exe"))
}
