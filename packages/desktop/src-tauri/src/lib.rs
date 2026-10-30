// 🖥️ Mikazuki's desktop app: one window with the game's production build inside (frontendDist: ../web, staged by
// scripts/stage.mjs). The game itself does the rest (packages/game src/net/desktop.ts): it talks to https://twigo.dev,
// logs in through the system browser (the opener plugin) and gets its login back as a mikazuki://auth link (the
// deep-link plugin). One copy at a time: a second launch (a login link, on Windows) hands its link to the first. New
// versions install themselves (the updater and process plugins; the install itself is the `install_update` command below).
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, RunEvent};

/// An update is being installed: closing the game's window then mustn't quit the app (the install does, on Windows).
static UPDATING: AtomicBool = AtomicBool::new(false);

/// What the page hears of the install (the `mk-update` event: net/desktop.ts).
#[derive(Clone, serde::Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
enum UpdateProgress {
    Downloading { got: u64, total: Option<u64> },
    Installing,
}

/// Installs the new version the updater has (twigo.dev/downloads/latest.json): downloads it, saying how far it got
/// (`mk-update` events), then installs it. On Windows the game's window is destroyed first, so the webview is gone
/// before the updater starts the installer and exits the process (it exits from inside the install call; exiting with
/// the webview alive could hang the old process, which then kept the single-instance mutex and swallowed every launch
/// after it: the 30 Oct 2026 "the game doesn't open again" report); the quiet installer reopens the app by itself. On
/// a Mac the app is swapped in place and restarted. An error comes back as its text (the page offers Try again).
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update".to_string())?;
    let mut got: u64 = 0;
    let bytes = update
        .download(
            |chunk, total| {
                got += chunk as u64;
                let _ = app.emit("mk-update", UpdateProgress::Downloading { got, total });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("mk-update", UpdateProgress::Installing);
    UPDATING.store(true, Ordering::SeqCst);
    #[cfg(windows)]
    {
        // The window goes first (the page has said "Mikazuki will close and open again by itself"), and the install waits
        // until it's gone (2 s at most), so the process the updater exits has no webview left.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.destroy();
        }
        for _ in 0..20 {
            if app.get_webview_window("main").is_none() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
    if let Err(e) = update.install(bytes) {
        UPDATING.store(false, Ordering::SeqCst);
        return Err(e.to_string());
    }
    #[cfg(not(windows))]
    app.restart();
    #[cfg(windows)]
    Ok(()) // (never reached: the updater exits the process once the installer is running)
}

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
        .invoke_handler(tauri::generate_handler![install_update])
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
        .build(tauri::generate_context!())
        .expect("error while building Mikazuki")
        .run(|_app, event| {
            // The last window closing quits the app, except while an update is installing (its window is closed on
            // purpose; the install quits the process itself).
            if let RunEvent::ExitRequested { code: None, api, .. } = &event {
                if UPDATING.load(Ordering::SeqCst) {
                    api.prevent_exit();
                }
            }
        });
}
