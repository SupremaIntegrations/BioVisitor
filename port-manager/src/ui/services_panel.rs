use crate::app::AdminApp;
use crate::model::{ServiceKey, ServiceStatus};
use crate::worker::Command;
use egui::{Color32, RichText, Ui};

fn status_color(status: ServiceStatus) -> Color32 {
    match status {
        ServiceStatus::Running => Color32::from_rgb(60, 170, 90),
        ServiceStatus::Stopped => Color32::from_rgb(190, 60, 60),
        ServiceStatus::StartPending
        | ServiceStatus::StopPending
        | ServiceStatus::PausePending
        | ServiceStatus::ContinuePending => Color32::from_rgb(210, 160, 40),
        ServiceStatus::Paused => Color32::from_rgb(150, 150, 60),
        ServiceStatus::NotFound | ServiceStatus::Unknown => Color32::GRAY,
    }
}

pub fn show(app: &mut AdminApp, ui: &mut Ui) {
    ui.heading("Servicios");
    ui.add_space(8.0);

    egui::Grid::new("services_grid")
        .num_columns(3)
        .spacing([16.0, 10.0])
        .show(ui, |ui| {
            for key in ServiceKey::ALL {
                let status = app
                    .statuses()
                    .get(&key)
                    .copied()
                    .unwrap_or(ServiceStatus::Unknown);

                ui.label(key.label());
                ui.label(RichText::new(status.to_string()).color(status_color(status)).strong());

                ui.horizontal(|ui| {
                    let disabled = app.busy_all();
                    ui.add_enabled_ui(!disabled, |ui| {
                        if ui.button("Iniciar").clicked() {
                            app.worker().send(Command::StartService(key));
                        }
                        if ui.button("Detener").clicked() {
                            app.worker().send(Command::StopService(key));
                        }
                        if ui.button("Reiniciar").clicked() {
                            app.worker().send(Command::RestartService(key));
                        }
                    });
                });
                ui.end_row();
            }
        });

    ui.add_space(16.0);
    ui.separator();
    ui.add_space(8.0);

    ui.horizontal(|ui| {
        ui.add_enabled_ui(!app.busy_all(), |ui| {
            if ui.button(RichText::new("Iniciar todo").strong()).clicked() {
                app.worker().send(Command::StartAll);
            }
            if ui.button(RichText::new("Detener todo").strong()).clicked() {
                app.worker().send(Command::StopAll);
            }
        });
    });
    ui.label(
        RichText::new(
            "\"Detener todo\" no detiene PostgreSQL ni Redis a propósito — \
             solo backend y frontend, igual que stop-all.bat.",
        )
        .weak()
        .small(),
    );
}
