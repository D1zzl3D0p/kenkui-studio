use crate::auth::Sessions;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn kenkui_auth_restore(
    origin: String,
    sessions: tauri::State<'_, Sessions>,
    client: tauri::State<'_, reqwest::Client>,
) -> Result<(), String> {
    sessions.restore(&origin, &client).await
}

#[tauri::command]
pub async fn kenkui_auth_sign_in(
    app: tauri::AppHandle,
    origin: String,
    sessions: tauri::State<'_, Sessions>,
    client: tauri::State<'_, reqwest::Client>,
) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = (app, origin, sessions, client);
        Err("Mobile sign-in is not available yet".into())
    }
    #[cfg(desktop)]
    sessions
        .sign_in(&origin, &client, |url| {
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|_| "Could not open the system browser".into())
        })
        .await
}

#[tauri::command]
pub fn kenkui_auth_cancel(sessions: tauri::State<'_, Sessions>) {
    sessions.cancel();
}

#[tauri::command]
pub async fn kenkui_auth_sign_out(
    origin: String,
    sessions: tauri::State<'_, Sessions>,
    client: tauri::State<'_, reqwest::Client>,
) -> Result<(), String> {
    sessions.sign_out(&origin, &client).await
}
