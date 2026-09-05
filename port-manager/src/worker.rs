//! Puente entre el hilo de UI (egui, immediate-mode, no puede bloquear) y
//! las llamadas al SCM/IP Helper/archivos, que sí pueden tardar segundos.
//! Un solo hilo de trabajo con canales `std::sync::mpsc` — no hace falta
//! tokio para esto.

use crate::config::AppConfig;
use crate::model::{AppResult, ServiceKey, ServiceStatus};
use crate::port_check::ListenerInfo;
use crate::{backup_restore, env_file, logging, nssm, postgres_conf, service_control, service_discovery};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone)]
pub enum Command {
    QueryAllStatus,
    StartService(ServiceKey),
    StopService(ServiceKey),
    RestartService(ServiceKey),
    StartAll,
    StopAll,
    ScanPorts,
    ApplyBackendPort { new_port: u16 },
    ApplyFrontendPorts { https: u16, http: u16, internal: u16 },
    ApplyPostgresPort { new_port: u16 },
    DetectRedisService,
    CreateBackup { dest_dir: PathBuf, password: String },
    InspectBackup { archive_path: PathBuf, password: String },
    RestoreBackup { archive_path: PathBuf, password: String, restore_env: bool },
}

pub struct InspectSummary {
    pub keys_match: bool,
    pub archive_has_key: bool,
}

pub enum Event {
    StatusUpdated(ServiceKey, ServiceStatus),
    OperationStarted(String),
    OperationSucceeded(String),
    OperationFailed(String, String),
    PortScanResult(Vec<ListenerInfo>),
    Progress(String),
    RedisDetected(Option<String>),
    BackupCreated(PathBuf),
    BackupInspected(Result<InspectSummary, String>),
}

pub struct Worker {
    tx_cmd: Sender<Command>,
    rx_evt: Receiver<Event>,
}

impl Worker {
    pub fn spawn(config: Arc<Mutex<AppConfig>>) -> Self {
        let (tx_cmd, rx_cmd) = mpsc::channel::<Command>();
        let (tx_evt, rx_evt) = mpsc::channel::<Event>();

        std::thread::spawn(move || run_loop(rx_cmd, tx_evt, config));

        Self { tx_cmd, rx_evt }
    }

    pub fn send(&self, cmd: Command) {
        let _ = self.tx_cmd.send(cmd);
    }

    pub fn try_recv(&self) -> Option<Event> {
        self.rx_evt.try_recv().ok()
    }
}

fn service_name(key: ServiceKey, config: &AppConfig) -> String {
    match key {
        ServiceKey::Backend => service_control::SVC_BACKEND.to_string(),
        ServiceKey::Frontend => service_control::SVC_FRONTEND.to_string(),
        ServiceKey::Postgres => service_control::SVC_POSTGRES.to_string(),
        ServiceKey::Redis => config.resolve_redis_service(),
    }
}

fn backend_env_path(install_dir: &PathBuf) -> PathBuf {
    install_dir.join("backend").join(".env")
}

fn run_loop(rx_cmd: Receiver<Command>, tx_evt: Sender<Event>, config: Arc<Mutex<AppConfig>>) {
    const RESTART_TIMEOUT: Duration = Duration::from_secs(30);

    while let Ok(cmd) = rx_cmd.recv() {
        let install_dir = config.lock().unwrap().resolve_install_dir();

        match cmd {
            Command::QueryAllStatus => {
                let cfg = config.lock().unwrap();
                for key in ServiceKey::ALL {
                    let name = service_name(key, &cfg);
                    let status = service_control::query_status(&name).unwrap_or(ServiceStatus::Unknown);
                    let _ = tx_evt.send(Event::StatusUpdated(key, status));
                }
            }

            Command::StartService(key) => {
                let name = { service_name(key, &config.lock().unwrap()) };
                let label = format!("Iniciar {key}");
                let _ = tx_evt.send(Event::OperationStarted(label.clone()));
                match service_control::start_service(&name) {
                    Ok(()) => {
                        logging::record("StartService", &format!(r#"SERVICE="{name}""#), "OK");
                        let _ = tx_evt.send(Event::OperationSucceeded(label));
                    }
                    Err(e) => {
                        logging::record("StartService", &format!(r#"SERVICE="{name}""#), &format!("ERROR: {e}"));
                        let _ = tx_evt.send(Event::OperationFailed(label, e.to_string()));
                    }
                }
                let status = service_control::query_status(&name).unwrap_or(ServiceStatus::Unknown);
                let _ = tx_evt.send(Event::StatusUpdated(key, status));
            }

            Command::StopService(key) => {
                let name = { service_name(key, &config.lock().unwrap()) };
                let label = format!("Detener {key}");
                let _ = tx_evt.send(Event::OperationStarted(label.clone()));
                match service_control::stop_service(&name) {
                    Ok(()) => {
                        logging::record("StopService", &format!(r#"SERVICE="{name}""#), "OK");
                        let _ = tx_evt.send(Event::OperationSucceeded(label));
                    }
                    Err(e) => {
                        logging::record("StopService", &format!(r#"SERVICE="{name}""#), &format!("ERROR: {e}"));
                        let _ = tx_evt.send(Event::OperationFailed(label, e.to_string()));
                    }
                }
                let status = service_control::query_status(&name).unwrap_or(ServiceStatus::Unknown);
                let _ = tx_evt.send(Event::StatusUpdated(key, status));
            }

            Command::RestartService(key) => {
                let name = { service_name(key, &config.lock().unwrap()) };
                let label = format!("Reiniciar {key}");
                let _ = tx_evt.send(Event::OperationStarted(label.clone()));
                match service_control::restart_service(&name, RESTART_TIMEOUT) {
                    Ok(()) => {
                        logging::record("RestartService", &format!(r#"SERVICE="{name}""#), "OK");
                        let _ = tx_evt.send(Event::OperationSucceeded(label));
                    }
                    Err(e) => {
                        logging::record("RestartService", &format!(r#"SERVICE="{name}""#), &format!("ERROR: {e}"));
                        let _ = tx_evt.send(Event::OperationFailed(label, e.to_string()));
                    }
                }
                let status = service_control::query_status(&name).unwrap_or(ServiceStatus::Unknown);
                let _ = tx_evt.send(Event::StatusUpdated(key, status));
            }

            Command::StartAll => run_start_all(&tx_evt, &config, &install_dir, RESTART_TIMEOUT),
            Command::StopAll => run_stop_all(&tx_evt, &config),

            Command::ScanPorts => match crate::port_check::list_tcp_listeners() {
                Ok(listeners) => {
                    let _ = tx_evt.send(Event::PortScanResult(listeners));
                }
                Err(e) => {
                    let _ = tx_evt.send(Event::OperationFailed(
                        "Escanear puertos".to_string(),
                        e.to_string(),
                    ));
                }
            },

            Command::ApplyBackendPort { new_port } => {
                let label = format!("Cambiar puerto del backend a {new_port}");
                let _ = tx_evt.send(Event::OperationStarted(label.clone()));
                let env_path = backend_env_path(&install_dir);
                let result: AppResult<()> = env_file::set_backend_port(&env_path, new_port)
                    .and_then(|_| service_control::restart_service(service_control::SVC_BACKEND, RESTART_TIMEOUT));
                report_and_log(&tx_evt, "ApplyBackendPort", &format!("PORT={new_port}"), result, label);
                let status = service_control::query_status(service_control::SVC_BACKEND).unwrap_or(ServiceStatus::Unknown);
                let _ = tx_evt.send(Event::StatusUpdated(ServiceKey::Backend, status));
            }

            Command::ApplyFrontendPorts { https, http, internal } => {
                let label = format!("Cambiar puertos del frontend a {https}/{http}/{internal}");
                let _ = tx_evt.send(Event::OperationStarted(label.clone()));
                let nssm_exe = nssm::nssm_path(&install_dir);
                let vars = [
                    ("NODE_ENV", "production"),
                    ("NEXT_PUBLIC_API_URL", "/api/v1"),
                    ("PORT", &https.to_string()),
                    ("HTTP_PORT", &http.to_string()),
                    ("NEXT_INTERNAL_PORT", &internal.to_string()),
                ];
                let result: AppResult<()> =
                    nssm::set_app_environment_extra(&nssm_exe, service_control::SVC_FRONTEND, &vars)
                        .and_then(|_| service_control::restart_service(service_control::SVC_FRONTEND, RESTART_TIMEOUT));
                report_and_log(
                    &tx_evt,
                    "ApplyFrontendPorts",
                    &format!("PORT={https} HTTP_PORT={http} NEXT_INTERNAL_PORT={internal}"),
                    result,
                    label,
                );
                let status = service_control::query_status(service_control::SVC_FRONTEND).unwrap_or(ServiceStatus::Unknown);
                let _ = tx_evt.send(Event::StatusUpdated(ServiceKey::Frontend, status));
            }

            Command::ApplyPostgresPort { new_port } => {
                let label = format!("Cambiar puerto de PostgreSQL a {new_port}");
                let _ = tx_evt.send(Event::OperationStarted(label.clone()));
                let result = apply_postgres_port(&install_dir, new_port, RESTART_TIMEOUT);
                report_and_log(&tx_evt, "ApplyPostgresPort", &format!("PORT={new_port}"), result, label);
                let pg_status = service_control::query_status(service_control::SVC_POSTGRES).unwrap_or(ServiceStatus::Unknown);
                let _ = tx_evt.send(Event::StatusUpdated(ServiceKey::Postgres, pg_status));
                let be_status = service_control::query_status(service_control::SVC_BACKEND).unwrap_or(ServiceStatus::Unknown);
                let _ = tx_evt.send(Event::StatusUpdated(ServiceKey::Backend, be_status));
            }

            Command::DetectRedisService => {
                let found = service_discovery::find_redis_service();
                let _ = tx_evt.send(Event::RedisDetected(found));
            }

            Command::CreateBackup { dest_dir, password } => {
                let label = "Crear backup".to_string();
                let _ = tx_evt.send(Event::OperationStarted(label.clone()));
                let opts = backup_restore::BackupOptions {
                    install_dir: &install_dir,
                    dest_dir: &dest_dir,
                    archive_password: &password,
                };
                match backup_restore::create_backup(&opts) {
                    Ok(path) => {
                        logging::record("CreateBackup", &format!("DEST={}", path.display()), "OK");
                        let _ = tx_evt.send(Event::BackupCreated(path));
                        let _ = tx_evt.send(Event::OperationSucceeded(label));
                    }
                    Err(e) => {
                        logging::record("CreateBackup", "", &format!("ERROR: {e}"));
                        let _ = tx_evt.send(Event::OperationFailed(label, e.to_string()));
                    }
                }
            }

            Command::InspectBackup { archive_path, password } => {
                let result = (|| -> Result<InspectSummary, String> {
                    let archive_env = backup_restore::peek_archive_env(&archive_path, &password)
                        .map_err(|e| e.to_string())?;
                    let archive_key = env_file::key_from_text(&archive_env, "ENCRYPTION_MASTER_KEY");
                    let current_key = env_file::get_encryption_master_key(&backend_env_path(&install_dir))
                        .ok()
                        .flatten();
                    Ok(InspectSummary {
                        archive_has_key: archive_key.is_some(),
                        keys_match: archive_key.is_some() && archive_key == current_key,
                    })
                })();
                let _ = tx_evt.send(Event::BackupInspected(result));
            }

            Command::RestoreBackup { archive_path, password, restore_env } => {
                let label = "Restaurar backup".to_string();
                let _ = tx_evt.send(Event::OperationStarted(label.clone()));

                let result = run_restore_sequence(&tx_evt, &install_dir, &archive_path, &password, restore_env, RESTART_TIMEOUT);
                match result {
                    Ok(()) => {
                        logging::record("RestoreBackup", &format!("ARCHIVE={}", archive_path.display()), "OK");
                        let _ = tx_evt.send(Event::OperationSucceeded(label));
                    }
                    Err(e) => {
                        logging::record("RestoreBackup", &format!("ARCHIVE={}", archive_path.display()), &format!("ERROR: {e}"));
                        let _ = tx_evt.send(Event::OperationFailed(label, e.to_string()));
                    }
                }
                for key in [ServiceKey::Backend, ServiceKey::Frontend] {
                    let name = service_name(key, &config.lock().unwrap());
                    let status = service_control::query_status(&name).unwrap_or(ServiceStatus::Unknown);
                    let _ = tx_evt.send(Event::StatusUpdated(key, status));
                }
            }
        }
    }
}

fn run_restore_sequence(
    tx_evt: &Sender<Event>,
    install_dir: &PathBuf,
    archive_path: &PathBuf,
    password: &str,
    restore_env: bool,
    timeout: Duration,
) -> AppResult<()> {
    let _ = tx_evt.send(Event::Progress("Deteniendo backend y frontend…".to_string()));
    match service_control::stop_service(service_control::SVC_FRONTEND) {
        Ok(()) | Err(crate::model::AppError::AlreadyInState(_, _)) => {}
        Err(e) => return Err(e),
    }
    match service_control::stop_service(service_control::SVC_BACKEND) {
        Ok(()) | Err(crate::model::AppError::AlreadyInState(_, _)) => {}
        Err(e) => return Err(e),
    }

    let _ = tx_evt.send(Event::Progress(
        "Creando respaldo de seguridad del estado actual antes de restaurar…".to_string(),
    ));
    let safety_dir = archive_path
        .parent()
        .map(|p| p.join("pre-restore-safety"))
        .unwrap_or_else(|| std::env::temp_dir());
    let safety_opts = backup_restore::BackupOptions {
        install_dir,
        dest_dir: &safety_dir,
        archive_password: password,
    };
    if let Err(e) = backup_restore::create_backup(&safety_opts) {
        let _ = tx_evt.send(Event::Progress(format!(
            "ADVERTENCIA: no se pudo crear el respaldo de seguridad previo ({e}). Continuando de todos modos."
        )));
    }

    let _ = tx_evt.send(Event::Progress("Restaurando base de datos y archivos…".to_string()));
    let restore_opts = backup_restore::RestoreOptions {
        install_dir,
        archive_path,
        archive_password: password,
        restore_env,
    };
    backup_restore::restore_backup(&restore_opts)?;

    let _ = tx_evt.send(Event::Progress("Reiniciando servicios…".to_string()));
    service_control::start_service(service_control::SVC_BACKEND).or_else(|e| match e {
        crate::model::AppError::AlreadyInState(_, _) => Ok(()),
        e => Err(e),
    })?;
    let backend_port = env_file::get_backend_port(&backend_env_path(install_dir)).unwrap_or(3001);
    let _ = service_control::wait_for_tcp_port(backend_port, timeout, Duration::from_secs(1));
    service_control::start_service(service_control::SVC_FRONTEND).or_else(|e| match e {
        crate::model::AppError::AlreadyInState(_, _) => Ok(()),
        e => Err(e),
    })?;

    Ok(())
}

fn report_and_log(
    tx_evt: &Sender<Event>,
    action: &str,
    detail: &str,
    result: AppResult<()>,
    label: String,
) {
    match result {
        Ok(()) => {
            logging::record(action, detail, "OK");
            let _ = tx_evt.send(Event::OperationSucceeded(label));
        }
        Err(e) => {
            logging::record(action, detail, &format!("ERROR: {e}"));
            let _ = tx_evt.send(Event::OperationFailed(label, e.to_string()));
        }
    }
}

fn apply_postgres_port(install_dir: &PathBuf, new_port: u16, timeout: Duration) -> AppResult<()> {
    let conf_path = postgres_conf::find_conf_path().ok_or_else(|| {
        crate::model::AppError::Other(
            "no se encontró postgresql.conf (¿PostgreSQL está en una ruta no estándar?)".to_string(),
        )
    })?;
    postgres_conf::set_port(&conf_path, new_port)?;
    env_file::set_db_port(&backend_env_path(install_dir), new_port)?;

    service_control::restart_service(service_control::SVC_POSTGRES, timeout)?;
    // Esperar a que PostgreSQL realmente acepte conexiones en el nuevo
    // puerto antes de reiniciar el backend — si no, el backend fallaría
    // su primer intento de conexión.
    service_control::wait_for_tcp_port(new_port, timeout, Duration::from_millis(500))?;
    service_control::restart_service(service_control::SVC_BACKEND, timeout)?;
    Ok(())
}

fn run_start_all(
    tx_evt: &Sender<Event>,
    config: &Arc<Mutex<AppConfig>>,
    install_dir: &PathBuf,
    timeout: Duration,
) {
    let _ = tx_evt.send(Event::OperationStarted("Iniciar todo".to_string()));

    let redis_name = config.lock().unwrap().resolve_redis_service();

    let _ = tx_evt.send(Event::Progress("Iniciando PostgreSQL y Redis…".to_string()));
    let pg_start = service_control::start_service(service_control::SVC_POSTGRES);
    let redis_start = service_control::start_service(&redis_name);
    if let Err(e) = pg_start {
        if !matches!(e, crate::model::AppError::AlreadyInState(_, _)) {
            let _ = tx_evt.send(Event::OperationFailed("Iniciar todo".to_string(), format!("PostgreSQL: {e}")));
            return;
        }
    }
    if let Err(e) = redis_start {
        if !matches!(e, crate::model::AppError::AlreadyInState(_, _)) {
            let _ = tx_evt.send(Event::OperationFailed("Iniciar todo".to_string(), format!("Redis: {e}")));
            return;
        }
    }
    let _ = service_control::wait_for_status(service_control::SVC_POSTGRES, ServiceStatus::Running, timeout, Duration::from_millis(500));
    let _ = service_control::wait_for_status(&redis_name, ServiceStatus::Running, timeout, Duration::from_millis(500));
    let _ = tx_evt.send(Event::StatusUpdated(ServiceKey::Postgres, service_control::query_status(service_control::SVC_POSTGRES).unwrap_or(ServiceStatus::Unknown)));
    let _ = tx_evt.send(Event::StatusUpdated(ServiceKey::Redis, service_control::query_status(&redis_name).unwrap_or(ServiceStatus::Unknown)));

    let _ = tx_evt.send(Event::Progress("Iniciando backend…".to_string()));
    if let Err(e) = service_control::start_service(service_control::SVC_BACKEND) {
        if !matches!(e, crate::model::AppError::AlreadyInState(_, _)) {
            let _ = tx_evt.send(Event::OperationFailed("Iniciar todo".to_string(), format!("Backend: {e}")));
            return;
        }
    }
    let backend_port = env_file::get_backend_port(&backend_env_path(install_dir)).unwrap_or(3001);
    let _ = tx_evt.send(Event::Progress(format!("Esperando que el backend responda en el puerto {backend_port}…")));
    if service_control::wait_for_tcp_port(backend_port, timeout, Duration::from_secs(1)).is_err() {
        let _ = tx_evt.send(Event::Progress("El backend no respondió a tiempo, se continúa igual con el frontend.".to_string()));
    }
    let _ = tx_evt.send(Event::StatusUpdated(ServiceKey::Backend, service_control::query_status(service_control::SVC_BACKEND).unwrap_or(ServiceStatus::Unknown)));

    let _ = tx_evt.send(Event::Progress("Iniciando frontend…".to_string()));
    let frontend_result = service_control::start_service(service_control::SVC_FRONTEND);
    let _ = tx_evt.send(Event::StatusUpdated(ServiceKey::Frontend, service_control::query_status(service_control::SVC_FRONTEND).unwrap_or(ServiceStatus::Unknown)));

    match frontend_result {
        Ok(()) | Err(crate::model::AppError::AlreadyInState(_, _)) => {
            logging::record("StartAll", "", "OK");
            let _ = tx_evt.send(Event::OperationSucceeded("Iniciar todo".to_string()));
        }
        Err(e) => {
            logging::record("StartAll", "", &format!("ERROR: {e}"));
            let _ = tx_evt.send(Event::OperationFailed("Iniciar todo".to_string(), format!("Frontend: {e}")));
        }
    }
}

fn run_stop_all(tx_evt: &Sender<Event>, config: &Arc<Mutex<AppConfig>>) {
    let _ = tx_evt.send(Event::OperationStarted("Detener todo".to_string()));
    let _ = tx_evt.send(Event::Progress("Deteniendo frontend…".to_string()));
    let frontend_result = service_control::stop_service(service_control::SVC_FRONTEND);
    let _ = tx_evt.send(Event::StatusUpdated(ServiceKey::Frontend, service_control::query_status(service_control::SVC_FRONTEND).unwrap_or(ServiceStatus::Unknown)));

    let _ = tx_evt.send(Event::Progress("Deteniendo backend…".to_string()));
    let backend_result = service_control::stop_service(service_control::SVC_BACKEND);
    let _ = tx_evt.send(Event::StatusUpdated(ServiceKey::Backend, service_control::query_status(service_control::SVC_BACKEND).unwrap_or(ServiceStatus::Unknown)));

    let _ = config; // PostgreSQL/Redis se dejan corriendo a propósito, como stop-all.bat

    let failed = [&frontend_result, &backend_result]
        .into_iter()
        .find_map(|r| match r {
            Err(e) if !matches!(e, crate::model::AppError::AlreadyInState(_, _)) => Some(e.to_string()),
            _ => None,
        });

    match failed {
        None => {
            logging::record("StopAll", "", "OK");
            let _ = tx_evt.send(Event::OperationSucceeded("Detener todo".to_string()));
        }
        Some(err) => {
            logging::record("StopAll", "", &format!("ERROR: {err}"));
            let _ = tx_evt.send(Event::OperationFailed("Detener todo".to_string(), err));
        }
    }
}
