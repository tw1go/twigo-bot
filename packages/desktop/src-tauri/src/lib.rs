// 🖥️ Mikazuki's desktop app: one window with the game's production build inside (frontendDist: ../web, staged by
// scripts/stage.mjs). The game itself does the rest (packages/game src/net/desktop.ts): it talks to https://twigo.dev,
// logs in through the system browser (the opener plugin) and gets its login back as a mikazuki://auth link (the
// deep-link plugin). One copy at a time: a second launch (a login link, on Windows) hands its link to the first. New
// versions install themselves (the updater and process plugins).
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
        // Updates from twigo.dev/downloads/latest.json, signed with the key whose public half is in tauri.conf.json
        // (scripts/publish.mjs signs them); the process plugin restarts the app into the new version.
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            // Windows and Linux learn the mikazuki:// scheme when the app runs (a Mac reads it from the bundle).
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                _app.deep_link().register_all()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Mikazuki");
}
