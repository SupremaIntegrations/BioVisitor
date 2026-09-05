use crate::app::AdminApp;
use crate::worker::Command;
use egui::Ui;
use std::path::PathBuf;

pub fn show(app: &mut AdminApp, ui: &mut Ui) {
    ui.heading("Configuración");
    ui.add_space(8.0);

    ui.group(|ui| {
        ui.label(egui::RichText::new("Directorio de instalación").strong());
        let form = app.settings_form_mut();
        ui.horizontal(|ui| {
            ui.add(egui::TextEdit::singleline(&mut form.install_dir).desired_width(400.0));
            if ui.button("Examinar…").clicked() {
                if let Some(dir) = rfd::FileDialog::new().pick_folder() {
                    form.install_dir = dir.display().to_string();
                }
            }
        });
        let dir_value = form.install_dir.clone();
        if ui.button("Guardar directorio").clicked() {
            let path = PathBuf::from(&dir_value);
            if crate::config::is_valid_install_dir(&path) {
                let mut cfg = app.config().lock().unwrap();
                cfg.set_install_dir_override(Some(path));
                let _ = cfg.save();
                drop(cfg);
                app.mark_ports_loaded_false();
            }
        }
        ui.label(
            egui::RichText::new(
                "Detectado automáticamente vía el registro de Windows si se deja vacío o inválido.",
            )
            .weak()
            .small(),
        );
    });

    ui.add_space(12.0);

    ui.group(|ui| {
        ui.label(egui::RichText::new("Servicio de Redis").strong());

        let mut detect_clicked = false;
        ui.horizontal(|ui| {
            let form = app.settings_form_mut();
            ui.add(egui::TextEdit::singleline(&mut form.redis_service).desired_width(250.0));
            if ui.button("Detectar automáticamente").clicked() {
                detect_clicked = true;
            }
        });
        if detect_clicked {
            app.worker().send(Command::DetectRedisService);
        }

        let redis_value = app.settings_form_mut().redis_service.clone();
        if ui.button("Guardar nombre de servicio").clicked() {
            let mut cfg = app.config().lock().unwrap();
            cfg.set_redis_service_override(Some(redis_value));
            let _ = cfg.save();
        }
        ui.label(
            egui::RichText::new(
                "Backend, frontend y PostgreSQL usan nombres de servicio fijos y no necesitan configurarse aquí.",
            )
            .weak()
            .small(),
        );
    });
}
