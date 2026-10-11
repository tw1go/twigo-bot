// The desktop app (see packages/desktop/README.md). No console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mikazuki_lib::run()
}
