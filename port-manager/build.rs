fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winresource::WindowsResource::new();
        res.set_manifest_file("res/manifest.xml");
        // El icono es opcional durante el desarrollo: solo se referencia si
        // ya existe (windows-deployment/assets/biovisitor.ico aun no se ha
        // creado — ver README-ICON.txt). Sin esto, un build limpio antes de
        // tener el .ico listo fallaria en vez de compilar sin icono.
        let icon_path = "assets/icon.ico";
        if std::path::Path::new(icon_path).exists() {
            res.set_icon(icon_path);
        }
        if let Err(e) = res.compile() {
            eprintln!("warning: no se pudo incrustar el manifiesto/icono de Windows: {e}");
        }
    }
}
