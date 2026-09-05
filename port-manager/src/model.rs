use std::fmt;

/// Los cuatro componentes que este tool sabe administrar. Backend, frontend
/// y PostgreSQL tienen nombres de servicio fijos y conocidos (ver
/// `service_control::KNOWN_SERVICE_NAMES`); Redis es el único cuyo nombre
/// real puede variar y se resuelve vía `service_discovery` + `Config`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ServiceKey {
    Backend,
    Frontend,
    Postgres,
    Redis,
}

impl ServiceKey {
    pub const ALL: [ServiceKey; 4] = [
        ServiceKey::Backend,
        ServiceKey::Frontend,
        ServiceKey::Postgres,
        ServiceKey::Redis,
    ];

    pub fn label(self) -> &'static str {
        match self {
            ServiceKey::Backend => "Backend",
            ServiceKey::Frontend => "Frontend",
            ServiceKey::Postgres => "PostgreSQL",
            ServiceKey::Redis => "Redis",
        }
    }
}

impl fmt::Display for ServiceKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.label())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceStatus {
    Running,
    Stopped,
    StartPending,
    StopPending,
    PausePending,
    Paused,
    ContinuePending,
    NotFound,
    Unknown,
}

impl fmt::Display for ServiceStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            ServiceStatus::Running => "En ejecución",
            ServiceStatus::Stopped => "Detenido",
            ServiceStatus::StartPending => "Iniciando…",
            ServiceStatus::StopPending => "Deteniendo…",
            ServiceStatus::PausePending => "Pausando…",
            ServiceStatus::Paused => "Pausado",
            ServiceStatus::ContinuePending => "Reanudando…",
            ServiceStatus::NotFound => "No encontrado",
            ServiceStatus::Unknown => "Desconocido",
        };
        f.write_str(s)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("El servicio \"{0}\" no existe en este equipo")]
    ServiceNotFound(String),
    #[error("Acceso denegado al servicio \"{0}\" (¿se está ejecutando como Administrador?)")]
    AccessDenied(String),
    #[error("El servicio \"{0}\" ya está {1}")]
    AlreadyInState(String, ServiceStatus),
    #[error("Tiempo de espera agotado esperando que \"{0}\" cambie de estado")]
    Timeout(String),
    #[error("Error de Windows en el servicio \"{0}\": {1}")]
    ServiceOther(String, String),
    #[error("Error leyendo/escribiendo el archivo de configuración: {0}")]
    EnvFile(String),
    #[error("nssm.exe terminó con código {exit_code}: {stderr}")]
    Nssm { exit_code: i32, stderr: String },
    #[error("{0}")]
    Other(String),
}

pub type AppResult<T> = Result<T, AppError>;
