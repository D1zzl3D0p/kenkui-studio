#[cfg(feature = "native-shell")]
use futures_util::future::{AbortHandle, Abortable};
use futures_util::StreamExt;
use serde::Serialize;
#[cfg(feature = "native-shell")]
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StreamMessage {
    Event { event: String, data: String },
    Error { message: String },
}

/// Keep bytes until a complete line arrives: network chunks can split UTF-8.
#[derive(Default)]
struct Parser {
    line: Vec<u8>,
    event: String,
    data: Vec<String>,
    skip_lf: bool,
    started: bool,
    pending_bytes: usize,
}

impl Parser {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<StreamMessage>, String> {
        let mut frames = Vec::new();
        for &byte in bytes {
            if self.skip_lf {
                self.skip_lf = false;
                if byte == b'\n' {
                    continue;
                }
            }
            self.pending_bytes += 1;
            if self.pending_bytes > 1024 * 1024 {
                return Err("Server event exceeded the size limit".into());
            }
            if byte != b'\r' && byte != b'\n' {
                self.line.push(byte);
                continue;
            }
            self.skip_lf = byte == b'\r';
            let bytes = std::mem::take(&mut self.line);
            let line = String::from_utf8_lossy(&bytes);
            let line = if !self.started {
                self.started = true;
                line.strip_prefix('\u{feff}').unwrap_or(&line)
            } else {
                &line
            };
            if line.is_empty() {
                if !self.data.is_empty() {
                    frames.push(StreamMessage::Event {
                        event: if self.event.is_empty() {
                            "message".into()
                        } else {
                            self.event.clone()
                        },
                        data: self.data.join("\n"),
                    });
                }
                self.event.clear();
                self.data.clear();
                self.pending_bytes = 0;
                continue;
            }
            if line.starts_with(':') {
                continue;
            }
            let (field, value) = line.split_once(':').unwrap_or((line, ""));
            let value = value.strip_prefix(' ').unwrap_or(value);
            match field {
                "event" => self.event = value.into(),
                "data" => self.data.push(value.into()),
                _ => {}
            }
        }
        Ok(frames)
    }
}

#[cfg(feature = "native-shell")]
#[derive(Default)]
pub struct Streams {
    next_id: AtomicU32,
    tasks: Arc<Mutex<HashMap<u32, AbortHandle>>>,
}

async fn forward_events(
    client: reqwest::Client,
    sessions: crate::auth::Sessions,
    url: reqwest::Url,
    mut send: impl FnMut(StreamMessage) -> Result<(), String>,
) -> Result<(), String> {
    let request = client
        .get(url.clone())
        .header("Accept", "text/event-stream");
    let response = crate::http::authenticated_send(&client, &sessions, &url, request)
        .await?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim();
    if !content_type.eq_ignore_ascii_case("text/event-stream") {
        return Err("The server did not return an event stream".into());
    }
    let mut stream = response.bytes_stream();
    let mut parser = Parser::default();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        for frame in parser.push(&chunk)? {
            send(frame)?;
        }
    }
    // A successful HTTP EOF still requires a snapshot and possibly reconnect.
    Err("The server closed the event stream".into())
}

/// Return an ID immediately so JS can cancel even while HTTP is connecting.
#[cfg(feature = "native-shell")]
#[tauri::command]
pub fn kenkui_events_open(
    url: String,
    channel: tauri::ipc::Channel<StreamMessage>,
    streams: tauri::State<'_, Streams>,
    client: tauri::State<'_, reqwest::Client>,
    sessions: tauri::State<'_, crate::auth::Sessions>,
) -> Result<u32, String> {
    let url = crate::http::server_url(&url)?;
    let (abort, registration) = AbortHandle::new_pair();
    let id = streams.next_id.fetch_add(1, Ordering::Relaxed);
    {
        let mut tasks = streams
            .tasks
            .lock()
            .map_err(|_| "Event stream state unavailable")?;
        if tasks.len() >= 32 {
            return Err("Too many active event streams".into());
        }
        tasks.insert(id, abort);
    }
    let tasks = Arc::clone(&streams.tasks);
    let client = client.inner().clone();
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn(async move {
        let forward = async {
            if let Err(message) = forward_events(client, sessions, url, |frame| {
                channel.send(frame).map_err(|error| error.to_string())
            })
            .await
            {
                let _ = channel.send(StreamMessage::Error { message });
            }
        };
        let _ = Abortable::new(forward, registration).await;
        if let Ok(mut tasks) = tasks.lock() {
            tasks.remove(&id);
        };
    });
    Ok(id)
}

#[cfg(feature = "native-shell")]
#[tauri::command]
pub fn kenkui_events_close(id: u32, streams: tauri::State<'_, Streams>) -> Result<(), String> {
    let mut tasks = streams
        .tasks
        .lock()
        .map_err(|_| "Event stream state unavailable")?;
    if let Some(task) = tasks.remove(&id) {
        task.abort();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    #[tokio::test]
    async fn forwarder_delivers_frames_then_reports_http_eof() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = reqwest::Url::parse(&format!(
            "http://{}/v1/jobs/1/events",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            socket.read(&mut request).await.unwrap();
            let body = "event: progress\r\ndata: ready\r\n\r\n";
            let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            socket.write_all(reply.as_bytes()).await.unwrap();
        });
        let mut frames = Vec::new();
        let result = forward_events(
            crate::http::client().unwrap(),
            crate::auth::Sessions::default(),
            url,
            |frame| {
                frames.push(frame);
                Ok(())
            },
        )
        .await;
        assert_eq!(frames, vec![event("progress", "ready")]);
        assert_eq!(result.err().unwrap(), "The server closed the event stream");
        server.await.unwrap();
    }

    fn event(name: &str, data: &str) -> StreamMessage {
        StreamMessage::Event {
            event: name.into(),
            data: data.into(),
        }
    }

    #[test]
    fn supports_line_endings_and_split_unicode_at_every_chunk_boundary() {
        for ending in ["\n", "\r\n", "\r"] {
            let input = format!("\u{feff}: heartbeat{ending}event: progress{ending}data: café 🎧{ending}data: two{ending}{ending}");
            for split in 0..=input.len() {
                let mut parser = Parser::default();
                let mut frames = parser.push(&input.as_bytes()[..split]).unwrap();
                frames.extend(parser.push(&input.as_bytes()[split..]).unwrap());
                assert_eq!(frames, vec![event("progress", "café 🎧\ntwo")]);
            }
        }
    }

    #[test]
    fn keeps_partial_frames_and_resets_event_names() {
        let mut parser = Parser::default();
        assert_eq!(
            parser
                .push(b"event: progress\ndata: one\n\ndata: par")
                .unwrap(),
            vec![event("progress", "one")]
        );
        assert_eq!(
            parser.push(b"tial\n\n").unwrap(),
            vec![event("message", "partial")]
        );
    }

    #[test]
    fn handles_comments_empty_data_and_unknown_fields() {
        let mut parser = Parser::default();
        assert_eq!(
            parser
                .push(b": comment\nid: 1\nretry: 500\nevent: ignored\n\ndata:\n\n")
                .unwrap(),
            vec![event("message", "")]
        );
    }

    #[test]
    fn bounds_unterminated_events() {
        assert!(Parser::default()
            .push(&vec![b'x'; 1024 * 1024 + 1])
            .is_err());
    }
}
