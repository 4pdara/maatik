// The desktop app is a window onto the maatik website: same login, same data on the
// engine. The window opens src/index.html, which goes on to the site (or explains
// that there is no connection).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("maatik desktop failed to start");
}
