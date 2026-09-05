use crate::config::AppConfig;
use crate::model::{ServiceKey, ServiceStatus};
use crate::port_check::ListenerInfo;
use crate::worker::{Command, Event, InspectSummary, Worker};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(PartialEq, Eq, Clone, Copy)]
pub enum Screen {
    Services,
    Ports,
    Backup,
    Diagnostics,
    Settings,
}

/// Un mensaje transitorio (éxito/error/info) mostrado en la parte
/// superior de la ventana durante unos segundos.
struct Toast {
    text: String,
    is_error: bool,
    shown_at: Instant,
}

pub struct PortsForm {
    pub backend_port: String,
    pub frontend_https: String,
    pub frontend_http: String,
    pub frontend_internal: String,
    pub postgres_port: String,
    pub redis_port_readonly: Option<u16>,
    pub loaded: bool,
}

impl Default for PortsForm {
    fn default() -> Self {
        Self {
            backend_port: String::new(),
            frontend_https: String::new(),
            frontend_http: String::new(),
            frontend_internal: String::new(),
            postgres_port: String::new(),
            redis_port_readonly: None,
            loaded: false,
        }
    }
}

pub struct SettingsForm {
    pub install_dir: String,
    pub redis_service: String,
}

pub struct BackupForm {
    pub dest_dir: String,
    pub create_password: String,
    pub last_created: Option<PathBuf>,

    pub archive_path: String,
    pub restore_password: String,
    pub restore_env: bool,
    pub inspect_result: Option<Result<InspectSummary, String>>,
}

impl Default for BackupForm {
    fn default() -> Self {
        Self {
            dest_dir: String::new(),
            create_password: String::new(),
            last_created: None,
            archive_path: String::new(),
            restore_password: String::new(),
            restore_env: true,
            inspect_result: None,
        }
    }
}

#[derive(Clone)]
pub struct PendingConflict {
    pub message: String,
    pub on_confirm: PendingAction,
}

#[derive(Clone)]
pub enum PendingAction {
    ApplyBackendPort(u16),
    ApplyFrontendPorts { https: u16, http: u16, internal: u16 },
    ApplyPostgresPort(u16),
}

pub struct AdminApp {
    worker: Worker,
    config: Arc<Mutex<AppConfig>>,

    screen: Screen,
    statuses: HashMap<ServiceKey, ServiceStatus>,
    busy: HashMap<ServiceKey, bool>,
    busy_all: bool,
    progress_line: Option<String>,
    toast: Option<Toast>,

    ports_form: PortsForm,
    settings_form: SettingsForm,
    backup_form: BackupForm,
    listeners: Option<Vec<ListenerInfo>>,
    scanning_ports: bool,

    pending_conflict: Option<PendingConflict>,

    last_status_poll: Instant,
}

impl AdminApp {
    pub fn new() -> Self {
        let config = Arc::new(Mutex::new(AppConfig::load()));
        let worker = Worker::spawn(config.clone());
        worker.send(Command::QueryAllStatus);

        let settings_form = {
            let cfg = config.lock().unwrap();
            SettingsForm {
                install_dir: cfg.resolve_install_dir().display().to_string(),
                redis_service: cfg.resolve_redis_service(),
            }
        };

        Self {
            worker,
            config,
            screen: Screen::Services,
            statuses: HashMap::new(),
            busy: HashMap::new(),
            busy_all: false,
            progress_line: None,
            toast: None,
            ports_form: PortsForm::default(),
            settings_form,
            backup_form: BackupForm::default(),
            listeners: None,
            scanning_ports: false,
            pending_conflict: None,
            last_status_poll: Instant::now(),
        }
    }

    fn drain_events(&mut self) {
        while let Some(evt) = self.worker.try_recv() {
            match evt {
                Event::StatusUpdated(key, status) => {
                    self.statuses.insert(key, status);
                }
                Event::OperationStarted(label) => {
                    self.busy_all = true;
                    self.progress_line = Some(format!("{label}…"));
                }
                Event::OperationSucceeded(label) => {
                    self.busy_all = false;
                    self.busy.clear();
                    self.progress_line = None;
                    self.toast = Some(Toast {
                        text: format!("{label}: completado"),
                        is_error: false,
                        shown_at: Instant::now(),
                    });
                }
                Event::OperationFailed(label, err) => {
                    self.busy_all = false;
                    self.busy.clear();
                    self.progress_line = None;
                    self.toast = Some(Toast {
                        text: format!("{label}: {err}"),
                        is_error: true,
                        shown_at: Instant::now(),
                    });
                }
                Event::PortScanResult(listeners) => {
                    self.listeners = Some(listeners);
                    self.scanning_ports = false;
                }
                Event::Progress(msg) => {
                    self.progress_line = Some(msg);
                }
                Event::RedisDetected(found) => {
                    if let Some(name) = found {
                        self.settings_form.redis_service = name.clone();
                        self.config.lock().unwrap().set_redis_service_override(Some(name));
                        let _ = self.config.lock().unwrap().save();
                    }
                }
                Event::BackupCreated(path) => {
                    self.backup_form.last_created = Some(path);
                }
                Event::BackupInspected(result) => {
                    self.backup_form.inspect_result = Some(result);
                }
            }
        }
    }

    fn ensure_ports_loaded(&mut self) {
        if self.ports_form.loaded {
            return;
        }
        let install_dir = self.config.lock().unwrap().resolve_install_dir();
        let env_path = install_dir.join("backend").join(".env");

        if let Ok(port) = crate::env_file::get_backend_port(&env_path) {
            self.ports_form.backend_port = port.to_string();
        }
        if let Ok(diag) = crate::env_file::get_diagnostic_ports(&env_path) {
            self.ports_form.redis_port_readonly = diag.redis_port;
        }
        let (https, http, internal) =
            crate::nssm::get_frontend_ports(crate::service_control::SVC_FRONTEND);
        self.ports_form.frontend_https = https.map(|p| p.to_string()).unwrap_or_else(|| "443".to_string());
        self.ports_form.frontend_http = http.map(|p| p.to_string()).unwrap_or_else(|| "80".to_string());
        self.ports_form.frontend_internal = internal.map(|p| p.to_string()).unwrap_or_else(|| "3000".to_string());

        if let Some(conf_path) = crate::postgres_conf::find_conf_path() {
            if let Ok(port) = crate::postgres_conf::get_port(&conf_path) {
                self.ports_form.postgres_port = port.to_string();
            }
        }
        if self.ports_form.postgres_port.is_empty() {
            if let Ok(diag) = crate::env_file::get_diagnostic_ports(&env_path) {
                if let Some(p) = diag.db_port {
                    self.ports_form.postgres_port = p.to_string();
                }
            }
        }

        self.ports_form.loaded = true;
    }

    fn check_and_apply(&mut self, port: u16, action: PendingAction, label: &str) {
        if let Some((pid, process)) = crate::port_check::is_port_free(port) {
            self.pending_conflict = Some(PendingConflict {
                message: format!(
                    "El puerto {port} ya está en uso por \"{process}\" (PID {pid}).\n\
                     Aplicar este cambio probablemente falle. ¿Continuar de todos modos?"
                ),
                on_confirm: action,
            });
        } else {
            self.dispatch_action(action);
            let _ = label;
        }
    }

    fn dispatch_action(&mut self, action: PendingAction) {
        match action {
            PendingAction::ApplyBackendPort(p) => self.worker.send(Command::ApplyBackendPort { new_port: p }),
            PendingAction::ApplyFrontendPorts { https, http, internal } => {
                self.worker.send(Command::ApplyFrontendPorts { https, http, internal })
            }
            PendingAction::ApplyPostgresPort(p) => self.worker.send(Command::ApplyPostgresPort { new_port: p }),
        }
        self.ports_form.loaded = false; // recargar valores tras aplicar
    }
}

impl eframe::App for AdminApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.drain_events();

        if self.last_status_poll.elapsed() > Duration::from_secs(4) && !self.busy_all {
            self.worker.send(Command::QueryAllStatus);
            self.last_status_poll = Instant::now();
        }

        if let Some(toast) = &self.toast {
            if toast.shown_at.elapsed() > Duration::from_secs(6) {
                self.toast = None;
            }
        }

        egui::TopBottomPanel::top("top").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.heading("BioVisitor Admin Tool");
                ui.separator();
                ui.selectable_value(&mut self.screen, Screen::Services, "Servicios");
                ui.selectable_value(&mut self.screen, Screen::Ports, "Puertos");
                ui.selectable_value(&mut self.screen, Screen::Backup, "Backup");
                ui.selectable_value(&mut self.screen, Screen::Diagnostics, "Diagnóstico");
                ui.selectable_value(&mut self.screen, Screen::Settings, "Configuración");
            });
            if let Some(progress) = &self.progress_line {
                ui.label(egui::RichText::new(progress).italics());
            }
            if let Some(toast) = &self.toast {
                let color = if toast.is_error {
                    egui::Color32::from_rgb(200, 60, 60)
                } else {
                    egui::Color32::from_rgb(60, 150, 80)
                };
                ui.label(egui::RichText::new(&toast.text).color(color));
            }
        });

        if let Some(conflict) = self.pending_conflict.clone() {
            egui::Window::new("Conflicto de puerto detectado")
                .collapsible(false)
                .resizable(false)
                .show(ctx, |ui| {
                    ui.label(&conflict.message);
                    ui.horizontal(|ui| {
                        if ui.button("Cancelar").clicked() {
                            self.pending_conflict = None;
                        }
                        if ui.button("Continuar de todos modos").clicked() {
                            self.dispatch_action(conflict.on_confirm.clone());
                            self.pending_conflict = None;
                        }
                    });
                });
        }

        egui::CentralPanel::default().show(ctx, |ui| match self.screen {
            Screen::Services => crate::ui::services_panel::show(self, ui),
            Screen::Ports => {
                self.ensure_ports_loaded();
                crate::ui::ports_panel::show(self, ui);
            }
            Screen::Backup => crate::ui::backup_panel::show(self, ui),
            Screen::Diagnostics => crate::ui::diagnostics_panel::show(self, ui),
            Screen::Settings => crate::ui::settings_panel::show(self, ui),
        });

        ctx.request_repaint_after(Duration::from_millis(500));
    }
}

// Accesores usados por los módulos de ui/*.rs, que viven en archivos
// separados y no pueden tocar los campos privados directamente.
impl AdminApp {
    pub fn worker(&self) -> &Worker {
        &self.worker
    }
    pub fn config(&self) -> &Arc<Mutex<AppConfig>> {
        &self.config
    }
    pub fn statuses(&self) -> &HashMap<ServiceKey, ServiceStatus> {
        &self.statuses
    }
    pub fn busy_all(&self) -> bool {
        self.busy_all
    }
    pub fn ports_form_mut(&mut self) -> &mut PortsForm {
        &mut self.ports_form
    }
    pub fn settings_form_mut(&mut self) -> &mut SettingsForm {
        &mut self.settings_form
    }
    pub fn backup_form_mut(&mut self) -> &mut BackupForm {
        &mut self.backup_form
    }
    pub fn listeners(&self) -> Option<&Vec<ListenerInfo>> {
        self.listeners.as_ref()
    }
    pub fn set_scanning_ports(&mut self, v: bool) {
        self.scanning_ports = v;
    }
    pub fn scanning_ports(&self) -> bool {
        self.scanning_ports
    }
    pub fn check_and_apply_pub(&mut self, port: u16, action: PendingAction, label: &str) {
        self.check_and_apply(port, action, label);
    }
    pub fn mark_ports_loaded_false(&mut self) {
        self.ports_form.loaded = false;
    }
}
