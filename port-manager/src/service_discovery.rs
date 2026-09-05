//! Enumeración de todos los servicios de Windows, usada solo para
//! autodetectar el de Redis (nombre variable según cómo se haya
//! instalado). Backend/Frontend/PostgreSQL tienen nombres fijos y no
//! necesitan esto — ver `service_control::SVC_*`.
//!
//! El crate `windows-service` no expone enumeración, así que esto usa
//! directamente `EnumServicesStatusExW` de la API Win32 vía el crate
//! `windows`.

use windows::core::PCWSTR;
use windows::Win32::System::Services::{
    CloseServiceHandle, EnumServicesStatusExW, OpenSCManagerW, ENUM_SERVICE_STATUS_PROCESSW,
    SC_ENUM_PROCESS_INFO, SC_MANAGER_ENUMERATE_SERVICE, SERVICE_STATE_ALL, SERVICE_WIN32,
};

struct DiscoveredService {
    name: String,
    display_name: String,
}

/// Convierte un puntero a wstring nul-terminado (apuntando dentro del
/// buffer que EnumServicesStatusExW devolvió) a un String de Rust. Solo
/// válido mientras el buffer de origen siga vivo.
unsafe fn pwstr_to_string(ptr: *mut u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    while *ptr.add(len) != 0 {
        len += 1;
    }
    let slice = std::slice::from_raw_parts(ptr, len);
    String::from_utf16_lossy(slice)
}

fn enumerate_services() -> windows::core::Result<Vec<DiscoveredService>> {
    unsafe {
        let manager = OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), SC_MANAGER_ENUMERATE_SERVICE)?;

        let result = (|| -> windows::core::Result<Vec<DiscoveredService>> {
            let mut bytes_needed: u32 = 0;
            let mut services_returned: u32 = 0;
            let mut resume_handle: u32 = 0;

            // Primera llamada sin buffer: solo para conocer el tamaño
            // necesario (patrón estándar de las API "EnumX" de Win32).
            let first_call = EnumServicesStatusExW(
                manager,
                SC_ENUM_PROCESS_INFO,
                SERVICE_WIN32,
                SERVICE_STATE_ALL,
                None,
                &mut bytes_needed,
                &mut services_returned,
                Some(&mut resume_handle),
                PCWSTR::null(),
            );
            // Se espera que falle con ERROR_MORE_DATA — eso es lo normal
            // aquí, no un error real; solo nos interesa `bytes_needed`.
            let _ = first_call;

            if bytes_needed == 0 {
                return Ok(Vec::new());
            }

            let mut buffer = vec![0u8; bytes_needed as usize];
            resume_handle = 0;
            EnumServicesStatusExW(
                manager,
                SC_ENUM_PROCESS_INFO,
                SERVICE_WIN32,
                SERVICE_STATE_ALL,
                Some(&mut buffer),
                &mut bytes_needed,
                &mut services_returned,
                Some(&mut resume_handle),
                PCWSTR::null(),
            )?;

            let entry_size = std::mem::size_of::<ENUM_SERVICE_STATUS_PROCESSW>();
            let entries = buffer.as_ptr() as *const ENUM_SERVICE_STATUS_PROCESSW;
            let mut out = Vec::with_capacity(services_returned as usize);
            for i in 0..services_returned as usize {
                // Los ENUM_SERVICE_STATUS_PROCESSW están empaquetados de
                // forma contigua al inicio del buffer; los PWSTR de cada
                // uno apuntan a texto más adelante en el MISMO buffer.
                debug_assert!((i + 1) * entry_size <= buffer.len());
                let entry = &*entries.add(i);
                out.push(DiscoveredService {
                    name: pwstr_to_string(entry.lpServiceName.0),
                    display_name: pwstr_to_string(entry.lpDisplayName.0),
                });
            }
            Ok(out)
        })();

        let _ = CloseServiceHandle(manager);
        result
    }
}

/// Busca un servicio cuyo nombre corto o nombre visible contenga "redis"
/// (sin distinguir mayúsculas), que es el patrón del servicio que instala
/// el MSI de tporadowski (nombre fijo "Redis") y de cualquier otra
/// instalación manual razonable.
pub fn find_redis_service() -> Option<String> {
    let services = enumerate_services().ok()?;
    services
        .into_iter()
        .find(|s| {
            s.name.to_lowercase().contains("redis") || s.display_name.to_lowercase().contains("redis")
        })
        .map(|s| s.name)
}
