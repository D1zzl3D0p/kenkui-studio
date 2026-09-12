pub mod http;
pub mod sse;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![http::kenkui_request, sse::kenkui_events_open])
        .run(tauri::generate_context!())
        .expect("error while running Kenkui Studio");
}
