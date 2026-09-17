//! Artifact bytes stay in Rust; the destination is replaced only after a complete transfer.
use futures_util::StreamExt;
use serde::Serialize;
use std::{
    io::Write,
    path::Path,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DownloadMessage {
    Progress { received: u64, total: Option<u64> },
    Sharing,
    Complete,
    Cancelled,
    Error { message: String },
}

pub async fn download(
    client: &reqwest::Client,
    sessions: &crate::auth::Sessions,
    url: &reqwest::Url,
    path: &Path,
    mut send: impl FnMut(DownloadMessage) -> Result<(), String>,
) -> Result<(), String> {
    let response = tokio::time::timeout(
        Duration::from_secs(60),
        crate::http::authenticated_send(client, sessions, url, client.get(url.clone())),
    )
    .await
    .map_err(|_| "The download timed out")??;
    if response.status() != reqwest::StatusCode::OK {
        return Err(format!(
            "Download failed (HTTP {})",
            response.status().as_u16()
        ));
    }
    let total = response.content_length();
    let parent = path.parent().ok_or("Invalid export destination")?;
    let mut file = tempfile::Builder::new()
        .prefix(".kenkui-download-")
        .tempfile_in(parent)
        .map_err(|e| format!("Cannot create download file: {e}"))?;
    let mut body = response.bytes_stream();
    let mut received = 0;
    let mut last = Instant::now();
    send(DownloadMessage::Progress { received, total })?;
    while let Some(chunk) = tokio::time::timeout(Duration::from_secs(60), body.next())
        .await
        .map_err(|_| "The download stalled")?
    {
        let chunk = chunk.map_err(|_| "The download connection was interrupted")?;
        file.write_all(&chunk)
            .map_err(|e| format!("Cannot write download: {e}"))?;
        received += chunk.len() as u64;
        if last.elapsed() >= Duration::from_millis(100) {
            send(DownloadMessage::Progress { received, total })?;
            last = Instant::now();
        }
    }
    if total.is_some_and(|total| total != received) {
        return Err("The download was incomplete".into());
    }
    send(DownloadMessage::Progress { received, total })?;
    // No await between sync and persist: cancellation cannot report success before commit.
    file.as_file()
        .sync_all()
        .map_err(|e| format!("Cannot flush download: {e}"))?;
    file.persist(path)
        .map_err(|e| format!("Cannot save download: {}", e.error))?;
    Ok(())
}

/// Isolated cache entries prevent filenames from overwriting earlier shares.
#[cfg(any(target_os = "android", target_os = "ios", test))]
fn prepare_mobile_export(
    cache: &Path,
    name: &str,
) -> Result<(tempfile::TempDir, std::path::PathBuf), String> {
    let root = cache.join("kenkui-exports");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    // Only entries owned by this exporter are eligible; never follow symlinks.
    for entry in std::fs::read_dir(&root)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        if entry.file_name().to_string_lossy().starts_with("export-")
            && entry.file_type().is_ok_and(|kind| kind.is_dir())
            && entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age > Duration::from_secs(86400))
        {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
    let directory = tempfile::Builder::new()
        .prefix("export-")
        .tempdir_in(root)
        .map_err(|e| e.to_string())?;
    let mut bytes = 0;
    let name: String = name
        .strip_suffix(".m4b")
        .unwrap_or(name)
        .chars()
        .take_while(|c| {
            bytes += c.len_utf8();
            bytes <= 180
        })
        .map(|c| {
            if c.is_control() || "/\\:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let name = name.trim_matches([' ', '.']);
    let name = if name.is_empty() { "Audiobook" } else { name };
    let path = directory.path().join(format!("{name}.m4b"));
    Ok((directory, path))
}

#[cfg(feature = "native-shell")]
mod commands {
    use super::*;
    use futures_util::future::{AbortHandle, Abortable};
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicU32, Ordering},
            Arc, Mutex,
        },
    };
    #[cfg(mobile)]
    use tauri::Manager;
    #[cfg(desktop)]
    use tauri_plugin_fs::FsExt;

    #[derive(Default)]
    pub struct Downloads {
        next: AtomicU32,
        tasks: Arc<Mutex<HashMap<u32, AbortHandle>>>,
    }

    #[tauri::command]
    pub async fn kenkui_download_start(
        window: tauri::WebviewWindow,
        app: tauri::AppHandle,
        url: String,
        path: Option<String>,
        suggested_name: Option<String>,
        channel: tauri::ipc::Channel<DownloadMessage>,
        downloads: tauri::State<'_, Downloads>,
        client: tauri::State<'_, reqwest::Client>,
        sessions: tauri::State<'_, crate::auth::Sessions>,
    ) -> Result<u32, String> {
        #[cfg(desktop)]
        let path = {
            let _ = (&app, &suggested_name);
            let path = std::path::PathBuf::from(path.ok_or("Choose an export destination")?);
            if !path.is_absolute() || !window.fs_scope().is_allowed(&path) {
                return Err("Choose an export destination using the save dialog.".into());
            }
            path
        };
        #[cfg(mobile)]
        let export = {
            let _ = (&window, &path);
            let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
            prepare_mobile_export(&cache, suggested_name.as_deref().unwrap_or("Audiobook.m4b"))?
        };
        #[cfg(mobile)]
        let path = export.1.clone();
        let url = crate::http::server_url(&url)?;
        let (abort, registration) = AbortHandle::new_pair();
        let id = downloads.next.fetch_add(1, Ordering::Relaxed);
        {
            let mut tasks = downloads
                .tasks
                .lock()
                .map_err(|_| "Download state unavailable")?;
            if !tasks.is_empty() {
                return Err("Another download is already running.".into());
            }
            tasks.insert(id, abort.clone());
        }
        let tasks = Arc::clone(&downloads.tasks);
        let client = client.inner().clone();
        let sessions = sessions.inner().clone();
        let runtime = tauri::async_runtime::handle();
        // Disk writes run on a blocking worker, keeping the async runtime responsive.
        tauri::async_runtime::spawn_blocking(move || {
            let result = runtime.block_on(Abortable::new(
                download(&client, &sessions, &url, &path, |frame| {
                    channel.send(frame).map_err(|e| e.to_string())
                }),
                registration,
            ));
            #[cfg(mobile)]
            let result = match result {
                Ok(Ok(())) if abort.is_aborted() => Err(futures_util::future::Aborted),
                Ok(Ok(())) => {
                    // The transfer can be cancelled; the native sheet owns dismissal after handoff.
                    let shared = channel
                        .send(DownloadMessage::Sharing)
                        .map_err(|e| e.to_string())
                        .and_then(|_| {
                            app.state::<tauri_plugin_mobile_export::MobileExport<tauri::Wry>>()
                                .share(&path)
                        });
                    if shared.is_ok() {
                        // Android recipients may read after the chooser returns. Expire on a later export.
                        let _ = export.0.keep();
                    }
                    Ok(shared)
                }
                result => result,
            };
            if let Ok(mut tasks) = tasks.lock() {
                tasks.remove(&id);
            }
            let frame = match result {
                Ok(Ok(())) => DownloadMessage::Complete,
                Ok(Err(message)) => DownloadMessage::Error { message },
                Err(_) => DownloadMessage::Cancelled,
            };
            let _ = channel.send(frame);
        });
        Ok(id)
    }

    #[tauri::command]
    pub fn kenkui_download_cancel(
        id: u32,
        downloads: tauri::State<'_, Downloads>,
    ) -> Result<(), String> {
        let tasks = downloads
            .tasks
            .lock()
            .map_err(|_| "Download state unavailable")?;
        if let Some(task) = tasks.get(&id) {
            task.abort();
        }
        Ok(())
    }
}
#[cfg(feature = "native-shell")]
pub use commands::*;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mobile_exports_are_isolated_and_cannot_escape_the_cache() {
        let cache = tempfile::tempdir().unwrap();
        for name in ["../../outside.m4b", "", "...", "book\\title.m4b", "a/b.m4b"] {
            let (dir, path) = prepare_mobile_export(cache.path(), name).unwrap();
            assert_eq!(path.parent(), Some(dir.path()));
            assert_eq!(path.extension().unwrap(), "m4b");
            std::fs::write(&path, b"audio").unwrap();
            let (other, other_path) = prepare_mobile_export(cache.path(), name).unwrap();
            assert_ne!(path, other_path);
            assert_eq!(std::fs::read(&path).unwrap(), b"audio");
            drop(other);
            drop(dir);
            assert!(!path.exists());
        }
    }

    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    async fn fixture(reply: &'static [u8]) -> (reqwest::Url, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = reqwest::Url::parse(&format!(
            "http://{}/v1/jobs/1/artifact",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            socket.read(&mut request).await.unwrap();
            socket.write_all(reply).await.unwrap();
        });
        (url, task)
    }

    #[tokio::test]
    async fn streams_chunked_body_and_replaces_destination_only_at_completion() {
        let (url, server) = fixture(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n3\r\ndef\r\n0\r\n\r\n").await;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.m4b");
        std::fs::write(&path, b"original").unwrap();
        let mut progress = Vec::new();
        download(
            &crate::http::client().unwrap(),
            &crate::auth::Sessions::default(),
            &url,
            &path,
            |frame| {
                assert_eq!(std::fs::read(&path).unwrap(), b"original");
                if let DownloadMessage::Progress { received, total } = frame {
                    progress.push((received, total));
                }
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"abcdef");
        assert_eq!(progress.last(), Some(&(6, None)));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn failed_and_truncated_responses_preserve_existing_file() {
        for reply in [
            &b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"[..],
            &b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial"[..],
            &b"HTTP/1.1 302 Found\r\nLocation: https://example.org\r\nContent-Length: 0\r\n\r\n"[..],
        ] {
            let (url, server) = fixture(reply).await;
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("book.m4b");
            std::fs::write(&path, b"original").unwrap();
            assert!(download(
                &crate::http::client().unwrap(),
                &crate::auth::Sessions::default(),
                &url,
                &path,
                |_| Ok(())
            )
            .await
            .is_err());
            assert_eq!(std::fs::read(&path).unwrap(), b"original");
            assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn cancellation_removes_partial_file_and_preserves_destination() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = reqwest::Url::parse(&format!(
            "http://{}/v1/jobs/1/artifact",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            socket.read(&mut request).await.unwrap();
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial")
                .await
                .unwrap();
            std::future::pending::<()>().await;
        });
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.m4b");
        std::fs::write(&path, b"original").unwrap();
        let (abort, registration) = futures_util::future::AbortHandle::new_pair();
        let client = crate::http::client().unwrap();
        let sessions = crate::auth::Sessions::default();
        let transfer = download(&client, &sessions, &url, &path, |_| {
            abort.abort();
            Ok(())
        });
        assert!(futures_util::future::Abortable::new(transfer, registration)
            .await
            .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        server.abort();
    }
}
