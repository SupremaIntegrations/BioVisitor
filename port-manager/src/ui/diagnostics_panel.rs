use crate::app::AdminApp;
use crate::worker::Command;
use egui::Ui;

pub fn show(app: &mut AdminApp, ui: &mut Ui) {
    ui.heading("Diagnóstico de puertos");
    ui.add_space(8.0);

    if ui.button("Escanear puertos en uso").clicked() {
        app.set_scanning_ports(true);
        app.worker().send(Command::ScanPorts);
    }
    if app.scanning_ports() {
        ui.label("Escaneando…");
    }

    ui.add_space(12.0);

    match app.listeners() {
        None => {
            ui.label("Sin datos todavía — presiona \"Escanear puertos en uso\".");
        }
        Some(listeners) => {
            let mut sorted: Vec<_> = listeners.iter().collect();
            sorted.sort_by_key(|l| l.port);

            egui::ScrollArea::vertical().show(ui, |ui| {
                egui::Grid::new("listeners_grid")
                    .num_columns(3)
                    .striped(true)
                    .spacing([20.0, 6.0])
                    .show(ui, |ui| {
                        ui.label(egui::RichText::new("Puerto").strong());
                        ui.label(egui::RichText::new("PID").strong());
                        ui.label(egui::RichText::new("Proceso").strong());
                        ui.end_row();

                        for l in sorted {
                            ui.label(l.port.to_string());
                            ui.label(l.pid.to_string());
                            ui.label(&l.process_name);
                            ui.end_row();
                        }
                    });
            });
        }
    }
}
