pub mod http;
pub mod sse;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![http::kenkui_request, sse::kenkui_events_open])
        .run(tauri::generate_context!())
        .expect("error while running Kenkui Studio");
}
