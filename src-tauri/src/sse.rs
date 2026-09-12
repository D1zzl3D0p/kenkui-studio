use futures_util::StreamExt;
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct Frame {
    pub event: String,
    pub data: String,
}

/// Drains every complete server-sent event from `buffer`, leaving any partial frame behind.
pub fn parse_frames(buffer: &mut String) -> Vec<Frame> {
    let mut frames = Vec::new();

    while let Some(index) = buffer.find("\n\n") {
        let block: String = buffer.drain(..index + 2).collect();
        let mut event = String::from("message");
        let mut data: Vec<String> = Vec::new();

        for line in block.lines() {
            if line.is_empty() || line.starts_with(':') {
                continue;
            }
            let (field, value) = match line.split_once(':') {
                Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
                None => (line, ""),
            };
            match field {
                "event" => event = value.to_string(),
                "data" => data.push(value.to_string()),
                _ => {}
            }
        }

        if !data.is_empty() {
            frames.push(Frame { event, data: data.join("\n") });
        }
    }

    frames
}

#[tauri::command]
pub async fn kenkui_events_open(
    url: String,
    channel: tauri::ipc::Channel<Frame>,
) -> Result<(), String> {
    let response = reqwest::Client::new()
        .get(&url)
        .header("Accept", "text/event-stream")
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        for frame in parse_frames(&mut buffer) {
            channel.send(frame).map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_event_and_keeps_the_data() {
        let mut buffer = String::from("event: progress\ndata: {\"sequence\":1}\n\n");
        let frames = parse_frames(&mut buffer);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].event, "progress");
        assert_eq!(frames[0].data, "{\"sequence\":1}");
        assert!(buffer.is_empty());
    }

    #[test]
    fn defaults_the_event_name_to_message() {
        let mut buffer = String::from("data: plain\n\n");
        assert_eq!(parse_frames(&mut buffer)[0].event, "message");
    }

    #[test]
    fn joins_multi_line_data_with_newlines() {
        let mut buffer = String::from("data: one\ndata: two\n\n");
        assert_eq!(parse_frames(&mut buffer)[0].data, "one\ntwo");
    }

    #[test]
    fn ignores_comments_and_unknown_fields() {
        let mut buffer = String::from(": keep-alive\nid: 7\nretry: 500\ndata: kept\n\n");
        let frames = parse_frames(&mut buffer);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, "kept");
    }

    #[test]
    fn retains_a_partial_frame_for_the_next_chunk() {
        let mut buffer = String::from("data: complete\n\ndata: partial");
        let frames = parse_frames(&mut buffer);
        assert_eq!(frames.len(), 1);
        assert_eq!(buffer, "data: partial");
    }
}
