pub mod http;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![http::kenkui_request])
        .run(tauri::generate_context!())
        .expect("error while running Kenkui Studio");
}
