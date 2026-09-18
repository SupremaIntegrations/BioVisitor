use crate::app::{AdminApp, PendingAction};
use egui::Ui;

fn port_field(ui: &mut Ui, label: &str, value: &mut String) {
    ui.horizontal(|ui| {
        ui.label(label);
        ui.add(egui::TextEdit::singleline(value).desired_width(80.0));
    });
}

fn parse_port(s: &str) -> Option<u16> {
    s.trim().parse::<u16>().ok().filter(|p| *p != 0)
}

pub fn show(app: &mut AdminApp, ui: &mut Ui) {
    ui.heading("Puertos");
    ui.add_space(8.0);
    ui.label(
        "Cambiar un puerto reinicia el servicio correspondiente. \
         Se verifica primero si el puerto nuevo ya está en uso por otro proceso.",
    );
    ui.add_space(12.0);

    ui.group(|ui| {
        ui.label(egui::RichText::new("Backend").strong());
        let form = app.ports_form_mut();
        port_field(ui, "Puerto API:", &mut form.backend_port);
        let backend_value = form.backend_port.clone();
        if ui.button("Guardar y reiniciar backend").clicked() {
            if let Some(port) = parse_port(&backend_value) {
                app.check_and_apply_pub(port, PendingAction::ApplyBackendPort(port), "backend");
            }
        }
    });

    ui.add_space(10.0);

    ui.group(|ui| {
        ui.label(egui::RichText::new("Frontend (nginx)").strong());
        let form = app.ports_form_mut();
        port_field(ui, "Puerto HTTPS (público):", &mut form.frontend_https);
        port_field(ui, "Puerto HTTP (redirección):", &mut form.frontend_http);
        let https = form.frontend_https.clone();
        let http = form.frontend_http.clone();
        if ui.button("Guardar y reiniciar frontend").clicked() {
            if let (Some(https), Some(http)) = (parse_port(&https), parse_port(&http)) {
                if https != http {
                    // El chequeo de conflicto se hace contra el puerto HTTPS
                    // (el principal); si ambos cambiaron y solo uno choca,
                    // el admin lo verá igual al aplicar y podrá reintentar.
                    app.check_and_apply_pub(
                        https,
                        PendingAction::ApplyFrontendPorts { https, http },
                        "frontend",
                    );
                }
            }
        }
    });

    ui.add_space(10.0);

    ui.group(|ui| {
        ui.label(egui::RichText::new("PostgreSQL (Suprema-LATAM-BioVisitor-Database-Service)").strong());
        let form = app.ports_form_mut();
        port_field(ui, "Puerto:", &mut form.postgres_port);
        let pg_value = form.postgres_port.clone();
        if ui.button("Guardar y reiniciar PostgreSQL + backend").clicked() {
            if let Some(port) = parse_port(&pg_value) {
                app.check_and_apply_pub(port, PendingAction::ApplyPostgresPort(port), "postgres");
            }
        }
        ui.label(
            egui::RichText::new(
                "Reinicia PostgreSQL y luego el backend, para que ambos queden sincronizados.",
            )
            .weak()
            .small(),
        );
    });

    ui.add_space(10.0);

    ui.group(|ui| {
        ui.label(egui::RichText::new("Redis").strong());
        let redis_port = app
            .ports_form_mut()
            .redis_port_readonly
            .map(|p| p.to_string())
            .unwrap_or_else(|| "desconocido".to_string());
        ui.label(format!("Puerto (solo referencia, no editable aquí): {redis_port}"));
    });
}
