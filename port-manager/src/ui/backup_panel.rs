use crate::app::AdminApp;
use crate::worker::Command;
use egui::Ui;
use std::path::PathBuf;

pub fn show(app: &mut AdminApp, ui: &mut Ui) {
    ui.heading("Backup y restauración");
    ui.add_space(8.0);
    ui.label(
        "Un backup incluye la base de datos, backend\\.env (contiene la clave de \
         cifrado — sin ella los datos de BioStar quedan indescifrables al restaurar), \
         las fotos de visitantes y el certificado SSL. El archivo queda cifrado con \
         la contraseña que elijas.",
    );

    ui.add_space(16.0);
    ui.group(|ui| {
        ui.label(egui::RichText::new("Crear backup").strong());

        let mut browse_clicked = false;
        {
            let form = app.backup_form_mut();
            ui.horizontal(|ui| {
                ui.label("Carpeta destino:");
                ui.add(egui::TextEdit::singleline(&mut form.dest_dir).desired_width(320.0));
                if ui.button("Examinar…").clicked() {
                    browse_clicked = true;
                }
            });
            ui.horizontal(|ui| {
                ui.label("Contraseña del backup:");
                ui.add(egui::TextEdit::singleline(&mut form.create_password).password(true).desired_width(200.0));
            });
        }
        if browse_clicked {
            if let Some(dir) = rfd::FileDialog::new().pick_folder() {
                app.backup_form_mut().dest_dir = dir.display().to_string();
            }
        }

        let (dest_dir, password) = {
            let form = app.backup_form_mut();
            (form.dest_dir.clone(), form.create_password.clone())
        };
        let can_create = !dest_dir.trim().is_empty() && !password.is_empty() && !app.busy_all();
        ui.add_enabled_ui(can_create, |ui| {
            if ui.button("Crear backup ahora").clicked() {
                app.worker().send(Command::CreateBackup {
                    dest_dir: PathBuf::from(dest_dir),
                    password,
                });
            }
        });

        if let Some(last) = &app.backup_form_mut().last_created {
            ui.label(format!("Último backup creado: {}", last.display()));
        }
    });

    ui.add_space(16.0);
    ui.group(|ui| {
        ui.label(egui::RichText::new("Restaurar backup").strong());
        ui.label(
            egui::RichText::new(
                "Antes de restaurar se detienen backend y frontend, y se crea automáticamente \
                 un respaldo de seguridad del estado actual por si algo sale mal.",
            )
            .weak()
            .small(),
        );

        let mut browse_clicked = false;
        {
            let form = app.backup_form_mut();
            ui.horizontal(|ui| {
                ui.label("Archivo de backup:");
                ui.add(egui::TextEdit::singleline(&mut form.archive_path).desired_width(320.0));
                if ui.button("Examinar…").clicked() {
                    browse_clicked = true;
                }
            });
            ui.horizontal(|ui| {
                ui.label("Contraseña:");
                ui.add(egui::TextEdit::singleline(&mut form.restore_password).password(true).desired_width(200.0));
            });
        }
        if browse_clicked {
            if let Some(file) = rfd::FileDialog::new().add_filter("Backup BioVisitor", &["zip"]).pick_file() {
                app.backup_form_mut().archive_path = file.display().to_string();
            }
        }

        let (archive_path, password) = {
            let form = app.backup_form_mut();
            (form.archive_path.clone(), form.restore_password.clone())
        };
        let have_inputs = !archive_path.trim().is_empty() && !password.is_empty();

        ui.add_enabled_ui(have_inputs && !app.busy_all(), |ui| {
            if ui.button("Verificar backup").clicked() {
                app.worker().send(Command::InspectBackup {
                    archive_path: PathBuf::from(archive_path.clone()),
                    password: password.clone(),
                });
            }
        });

        if let Some(result) = &app.backup_form_mut().inspect_result {
            match result {
                Ok(summary) => {
                    if !summary.archive_has_key {
                        ui.colored_label(
                            egui::Color32::from_rgb(200, 140, 40),
                            "El backup no tiene ENCRYPTION_MASTER_KEY en su backend.env.",
                        );
                    } else if summary.keys_match {
                        ui.colored_label(
                            egui::Color32::from_rgb(60, 150, 80),
                            "La clave de cifrado del backup coincide con la instalación actual.",
                        );
                    } else {
                        ui.colored_label(
                            egui::Color32::from_rgb(200, 60, 60),
                            "La clave de cifrado del backup es DIFERENTE a la actual. Si no \
                             restauras también backend\\.env, las credenciales de BioStar en \
                             la base de datos restaurada quedarán indescifrables.",
                        );
                    }
                }
                Err(e) => {
                    ui.colored_label(egui::Color32::from_rgb(200, 60, 60), format!("No se pudo verificar: {e}"));
                }
            }
        }

        ui.checkbox(&mut app.backup_form_mut().restore_env, "Restaurar también backend\\.env (recomendado)");

        ui.add_enabled_ui(have_inputs && !app.busy_all(), |ui| {
            if ui.button(egui::RichText::new("Restaurar ahora").strong()).clicked() {
                let restore_env = app.backup_form_mut().restore_env;
                app.worker().send(Command::RestoreBackup {
                    archive_path: PathBuf::from(archive_path),
                    password,
                    restore_env,
                });
            }
        });
    });
}
