use crate::sidecar::{Action, Status, Supervisor};
use std::sync::Arc;
use tauri::Manager;

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[allow(unused_mut)]
    let mut config = None;
    // Until packaging and local authentication are ready, release/mobile builds
    // cannot opt in, even if these environment variables are present.
    #[cfg(all(desktop, debug_assertions))]
    if let Some(python) = std::env::var_os("KENKUI_SIDECAR_PYTHON") {
        let executable = std::path::PathBuf::from(python);
        if !executable.is_absolute() || !executable.is_file() {
            return Err("KENKUI_SIDECAR_PYTHON must name an absolute Python executable".into());
        }
        config = Some(crate::sidecar::Config {
            executable,
            script: std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../sidecar/kenkui_sidecar.py"),
            data_dir: app.path().app_local_data_dir()?.join("local-server"),
            provision_voices: true,
            startup_timeout: std::time::Duration::from_secs(30 * 60),
            shutdown_timeout: std::time::Duration::from_secs(15),
        });
    }
    app.manage(Arc::new(Supervisor::new(config)));
    Ok(())
}

async fn request(app: tauri::AppHandle, action: Action) -> Result<Status, String> {
    let supervisor = app.state::<Arc<Supervisor>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || supervisor.request(action))
        .await
        .map_err(|_| "Local server supervisor failed".to_string())?
}

#[tauri::command]
pub async fn kenkui_local_server_start(app: tauri::AppHandle) -> Result<Status, String> {
    request(app, Action::Start).await
}
#[tauri::command]
pub async fn kenkui_local_server_stop(app: tauri::AppHandle) -> Result<Status, String> {
    request(app, Action::Stop).await
}
#[tauri::command]
pub async fn kenkui_local_server_status(app: tauri::AppHandle) -> Result<Status, String> {
    request(app, Action::Status).await
}

pub fn shutdown(app: &tauri::AppHandle) {
    // The actor closes stdin, waits for the grace period, then kills and reaps.
    if let Some(supervisor) = app.try_state::<Arc<Supervisor>>() {
        let _ = supervisor.request(Action::Quit);
    }
}
