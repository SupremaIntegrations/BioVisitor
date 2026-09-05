//! Control nativo del Service Control Manager de Windows — start/stop/
//! restart/query de cualquier servicio por nombre, sin pasar por NSSM
//! (funciona igual sin importar qué registró el servicio). `nssm.rs` solo
//! se usa aparte para el único parámetro que el SCM no expone:
//! `AppEnvironmentExtra` del frontend.

use crate::model::{AppError, AppResult, ServiceStatus};
use std::time::{Duration, Instant};
use windows_service::service::{ServiceAccess, ServiceState};
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

const ERROR_SERVICE_DOES_NOT_EXIST: i32 = 1060;
const ERROR_ACCESS_DENIED: i32 = 5;
const ERROR_SERVICE_ALREADY_RUNNING: i32 = 1056;
const ERROR_SERVICE_NOT_ACTIVE: i32 = 1062;

/// Nombres de servicio de Windows fijos y conocidos — ver comentario en
/// windows-deployment/setup/biovisitor-setup.iss sobre por qué backend y
/// frontend nunca cambian de nombre, y por qué PostgreSQL ahora también
/// tiene uno dedicado (evita ambigüedad con otro PostgreSQL genérico que
/// pudiera existir en el mismo servidor).
pub const SVC_BACKEND: &str = "Suprema LATAM BioVisitor Service";
pub const SVC_FRONTEND: &str = "Suprema LATAM BioVisitor Web GUI";
pub const SVC_POSTGRES: &str = "BioVisitor Database Service";

fn map_windows_service_error(name: &str, err: windows_service::Error) -> AppError {
    match err {
        windows_service::Error::Winapi(io_err) => match io_err.raw_os_error() {
            Some(ERROR_SERVICE_DOES_NOT_EXIST) => AppError::ServiceNotFound(name.to_string()),
            Some(ERROR_ACCESS_DENIED) => AppError::AccessDenied(name.to_string()),
            _ => AppError::ServiceOther(name.to_string(), io_err.to_string()),
        },
        other => AppError::ServiceOther(name.to_string(), other.to_string()),
    }
}

fn to_model_status(state: ServiceState) -> ServiceStatus {
    match state {
        ServiceState::Running => ServiceStatus::Running,
        ServiceState::Stopped => ServiceStatus::Stopped,
        ServiceState::StartPending => ServiceStatus::StartPending,
        ServiceState::StopPending => ServiceStatus::StopPending,
        ServiceState::PausePending => ServiceStatus::PausePending,
        ServiceState::Paused => ServiceStatus::Paused,
        ServiceState::ContinuePending => ServiceStatus::ContinuePending,
    }
}

fn open_manager() -> AppResult<ServiceManager> {
    ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .map_err(|e| AppError::Other(format!("no se pudo conectar al Service Control Manager: {e}")))
}

pub fn query_status(name: &str) -> AppResult<ServiceStatus> {
    let manager = open_manager()?;
    let service = match manager.open_service(name, ServiceAccess::QUERY_STATUS) {
        Ok(s) => s,
        Err(windows_service::Error::Winapi(e))
            if e.raw_os_error() == Some(ERROR_SERVICE_DOES_NOT_EXIST) =>
        {
            return Ok(ServiceStatus::NotFound)
        }
        Err(e) => return Err(map_windows_service_error(name, e)),
    };
    let status = service
        .query_status()
        .map_err(|e| map_windows_service_error(name, e))?;
    Ok(to_model_status(status.current_state))
}

pub fn start_service(name: &str) -> AppResult<()> {
    let manager = open_manager()?;
    let service = manager
        .open_service(name, ServiceAccess::START | ServiceAccess::QUERY_STATUS)
        .map_err(|e| map_windows_service_error(name, e))?;

    let current = service
        .query_status()
        .map_err(|e| map_windows_service_error(name, e))?
        .current_state;
    if current == ServiceState::Running {
        return Err(AppError::AlreadyInState(name.to_string(), ServiceStatus::Running));
    }

    match service.start::<&str>(&[]) {
        Ok(()) => Ok(()),
        Err(windows_service::Error::Winapi(e))
            if e.raw_os_error() == Some(ERROR_SERVICE_ALREADY_RUNNING) =>
        {
            Err(AppError::AlreadyInState(name.to_string(), ServiceStatus::Running))
        }
        Err(e) => Err(map_windows_service_error(name, e)),
    }
}

pub fn stop_service(name: &str) -> AppResult<()> {
    let manager = open_manager()?;
    let service = manager
        .open_service(name, ServiceAccess::STOP | ServiceAccess::QUERY_STATUS)
        .map_err(|e| map_windows_service_error(name, e))?;

    let current = service
        .query_status()
        .map_err(|e| map_windows_service_error(name, e))?
        .current_state;
    if current == ServiceState::Stopped {
        return Err(AppError::AlreadyInState(name.to_string(), ServiceStatus::Stopped));
    }

    match service.stop() {
        Ok(_) => Ok(()),
        Err(windows_service::Error::Winapi(e))
            if e.raw_os_error() == Some(ERROR_SERVICE_NOT_ACTIVE) =>
        {
            Err(AppError::AlreadyInState(name.to_string(), ServiceStatus::Stopped))
        }
        Err(e) => Err(map_windows_service_error(name, e)),
    }
}

/// Espera (con sondeo) a que un servicio alcance el estado pedido. Se usa
/// tanto en `restart_service` como en las secuencias de Start All / Stop
/// All, donde hay que esperar a que un paso termine antes del siguiente.
pub fn wait_for_status(
    name: &str,
    target: ServiceStatus,
    timeout: Duration,
    poll_interval: Duration,
) -> AppResult<()> {
    let deadline = Instant::now() + timeout;
    loop {
        let current = query_status(name)?;
        if current == target {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(AppError::Timeout(name.to_string()));
        }
        std::thread::sleep(poll_interval);
    }
}

pub fn restart_service(name: &str, timeout: Duration) -> AppResult<()> {
    // stop_service/start_service tratan "ya estaba detenido/iniciado" como
    // AlreadyInState — en un restart eso es información, no un fallo real,
    // así que se ignora explícitamente en cada paso.
    match stop_service(name) {
        Ok(()) | Err(AppError::AlreadyInState(_, _)) => {}
        Err(e) => return Err(e),
    }
    wait_for_status(name, ServiceStatus::Stopped, timeout, Duration::from_millis(500))?;

    match start_service(name) {
        Ok(()) | Err(AppError::AlreadyInState(_, _)) => {}
        Err(e) => return Err(e),
    }
    wait_for_status(name, ServiceStatus::Running, timeout, Duration::from_millis(500))
}

/// Sondeo TCP simple a 127.0.0.1:puerto — equivalente Rust de
/// `waitPort()` en windows-deployment/supervisor.js, usado para saber
/// cuándo el backend ya acepta conexiones antes de arrancar el frontend.
pub fn wait_for_tcp_port(port: u16, timeout: Duration, poll_interval: Duration) -> AppResult<()> {
    use std::net::{SocketAddr, TcpStream};

    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let deadline = Instant::now() + timeout;
    loop {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(AppError::Timeout(format!("puerto {port}")));
        }
        std::thread::sleep(poll_interval);
    }
}
