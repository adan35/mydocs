/// The desktop shell: one window running the same web app, plus the native
/// pieces it can't do on its own (save dialogs, writing files, opening links,
/// and checking for signed updates).
mod open_files;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().manage(open_files::OpenFiles::default());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        use tauri::Manager;
        open_files::enqueue(app, args, &cwd);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    builder
        .invoke_handler(tauri::generate_handler![open_files::take_open_file])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                let cwd = std::env::current_dir()?.to_string_lossy().into_owned();
                open_files::enqueue(app.handle(), std::env::args().collect(), &cwd);
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running My Doc");
}
