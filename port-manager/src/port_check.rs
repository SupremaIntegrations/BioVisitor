//! Diagnóstico de puertos: qué proceso (PID + nombre) tiene ocupado un
//! puerto TCP dado, vía la IP Helper API (`GetExtendedTcpTable`). Se usa
//! tanto en el panel de Diagnóstico como chequeo previo antes de aplicar
//! un cambio de puerto o reiniciar un servicio — mismo objetivo que
//! `IsPortInUse`/`CheckPortConflicts` en biovisitor-setup.iss, pero nativo
//! en vez de invocar PowerShell, y con el nombre del proceso conflictivo.
//!
//! Solo IPv4: todos los servicios que administra este programa escuchan
//! en loopback/todas-las-interfaces IPv4 (ver server-https.js,
//! supervisor.js) — no hay necesidad práctica de sondear la tabla IPv6.

use windows::Win32::Foundation::{CloseHandle, ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS};
use windows::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
};
use windows::Win32::Networking::WinSock::AF_INET;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};

pub struct ListenerInfo {
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
}

/// Lista todos los sockets TCP IPv4 en estado LISTEN, con su PID
/// propietario. Usa el patrón estándar de dos llamadas: primero para
/// conocer el tamaño del buffer, luego para obtener los datos.
pub fn list_tcp_listeners() -> anyhow::Result<Vec<ListenerInfo>> {
    unsafe {
        let mut size: u32 = 0;
        let first = GetExtendedTcpTable(
            None,
            &mut size,
            true,
            AF_INET.0 as u32,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        );
        if first != ERROR_INSUFFICIENT_BUFFER.0 && first != ERROR_SUCCESS.0 {
            anyhow::bail!("GetExtendedTcpTable (tamaño) falló con código {first}");
        }
        if size == 0 {
            return Ok(Vec::new());
        }

        let mut buffer = vec![0u8; size as usize];
        let second = GetExtendedTcpTable(
            Some(buffer.as_mut_ptr() as *mut _),
            &mut size,
            true,
            AF_INET.0 as u32,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        );
        if second != ERROR_SUCCESS.0 {
            anyhow::bail!("GetExtendedTcpTable falló con código {second}");
        }

        // MIB_TCPTABLE_OWNER_PID es un struct de tamaño variable en C:
        // dwNumEntries seguido de un arreglo de dwNumEntries filas. El
        // binding de Rust modela el arreglo como longitud 1 (miembro
        // flexible), así que hay que leer más allá de sus límites
        // declarados a propósito, tal como lo espera la API de Windows.
        let table_ptr = buffer.as_ptr() as *const MIB_TCPTABLE_OWNER_PID;
        let num_entries = (*table_ptr).dwNumEntries as usize;
        let rows_ptr = (*table_ptr).table.as_ptr();

        let mut out = Vec::with_capacity(num_entries);
        for i in 0..num_entries {
            let row: MIB_TCPROW_OWNER_PID = *rows_ptr.add(i);
            let port = u16::from_be((row.dwLocalPort & 0xFFFF) as u16);
            out.push(ListenerInfo {
                port,
                pid: row.dwOwningPid,
                process_name: process_name_for_pid(row.dwOwningPid)
                    .unwrap_or_else(|| format!("PID {}", row.dwOwningPid)),
            });
        }
        Ok(out)
    }
}

pub fn process_name_for_pid(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

        let mut buf = [0u16; 260];
        let mut len = buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(handle);

        result.ok()?;
        let full_path = String::from_utf16_lossy(&buf[..len as usize]);
        Some(
            full_path
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or(&full_path)
                .to_string(),
        )
    }
}

/// `None` si el puerto está libre; si está ocupado, el PID y nombre del
/// proceso que lo tiene. Usado como chequeo previo antes de guardar un
/// cambio de puerto o reiniciar un servicio.
pub fn is_port_free(port: u16) -> Option<(u32, String)> {
    let listeners = list_tcp_listeners().ok()?;
    listeners
        .into_iter()
        .find(|l| l.port == port)
        .map(|l| (l.pid, l.process_name))
}
