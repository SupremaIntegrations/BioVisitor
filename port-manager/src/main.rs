// Sin consola en release: es una app de escritorio, no una CLI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod backup_restore;
mod config;
mod env_file;
mod install_dir;
mod logging;
mod model;
mod nginx_conf;
mod port_check;
mod postgres_conf;
mod postgres_tools;
mod service_control;
mod service_discovery;
mod ui;
mod worker;

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([760.0, 560.0])
            .with_min_inner_size([600.0, 420.0]),
        ..Default::default()
    };

    eframe::run_native(
        "BioVisitor Admin Tool",
        options,
        Box::new(|_cc| Ok(Box::new(app::AdminApp::new()))),
    )
}
