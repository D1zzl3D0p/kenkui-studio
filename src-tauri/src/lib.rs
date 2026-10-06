pub mod auth;
#[cfg(feature = "native-shell")]
mod auth_commands;
pub mod download;
pub mod http;
pub mod sidecar;
#[cfg(feature = "native-shell")]
mod sidecar_commands;
pub mod sse;
#[cfg(feature = "native-shell")]
use tauri::Manager;

#[cfg(feature = "native-shell")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // One process owns credential rotation for each OS user.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    builder
        .manage(sse::Streams::default())
        .manage(download::Downloads::default())
        .manage(auth::Sessions::default())
        .setup(|app| {
            app.manage(http::client()?);
            sidecar_commands::setup(app)?;
            Ok(())
        })
        .plugin(tauri_plugin_mobile_export::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .on_window_event(|_window, _event| {
            #[cfg(mobile)]
            if matches!(_event, tauri::WindowEvent::Resumed) {
                use tauri::Emitter;
                let _ = _window.emit("kenkui:resume", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            http::kenkui_request,
            download::kenkui_download_start,
            download::kenkui_download_cancel,
            sse::kenkui_events_open,
            sse::kenkui_events_close,
            auth_commands::kenkui_auth_restore,
            auth_commands::kenkui_auth_sign_in,
            auth_commands::kenkui_auth_cancel,
            auth_commands::kenkui_auth_sign_out,
            sidecar_commands::kenkui_local_server_start,
            sidecar_commands::kenkui_local_server_stop,
            sidecar_commands::kenkui_local_server_status,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Kenkui Studio")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                sidecar_commands::shutdown(app);
            }
        });
}
