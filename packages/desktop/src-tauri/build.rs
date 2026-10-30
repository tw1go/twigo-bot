fn main() {
    // The app's own commands get permissions (allow-<command>), listed in capabilities/default.json.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["install_update"]))).expect("failed to run tauri-build");
}
