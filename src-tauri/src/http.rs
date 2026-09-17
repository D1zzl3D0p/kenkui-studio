use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Deserialize)]
pub struct RequestSpec {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    #[serde(rename = "timeoutMs", default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

fn default_timeout_ms() -> u64 {
    120_000
}

pub fn client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

pub fn server_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid server URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Use an HTTP or HTTPS server URL without embedded credentials".into());
    }
    Ok(url)
}

#[derive(Serialize)]
pub struct ResponseSpec {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// Only the verbs the /v1 client actually issues.
pub fn method_from(name: &str) -> Result<reqwest::Method, String> {
    match name.to_ascii_uppercase().as_str() {
        "GET" => Ok(reqwest::Method::GET),
        "POST" => Ok(reqwest::Method::POST),
        "DELETE" => Ok(reqwest::Method::DELETE),
        other => Err(format!("unsupported method: {other}")),
    }
}

#[cfg(feature = "native-shell")]
#[tauri::command]
pub async fn kenkui_request(
    spec: RequestSpec,
    client: tauri::State<'_, reqwest::Client>,
    sessions: tauri::State<'_, crate::auth::Sessions>,
) -> Result<ResponseSpec, String> {
    execute_request(spec, &client, &sessions).await
}

pub async fn execute_request(
    spec: RequestSpec,
    client: &reqwest::Client,
    sessions: &crate::auth::Sessions,
) -> Result<ResponseSpec, String> {
    let mut request = client
        .request(method_from(&spec.method)?, server_url(&spec.url)?)
        .timeout(Duration::from_millis(spec.timeout_ms.clamp(1_000, 120_000)));
    for (name, value) in &spec.headers {
        if name.eq_ignore_ascii_case("authorization") || name.eq_ignore_ascii_case("cookie") {
            return Err("Credentials must be managed by the native host".into());
        }
        request = request.header(name, value);
    }
    if let Some(body) = spec.body {
        request = request.body(body);
    }

    let response = authenticated_send(client, sessions, &server_url(&spec.url)?, request).await?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter(|(name, _)| {
            *name != reqwest::header::SET_COOKIE && *name != reqwest::header::AUTHORIZATION
        })
        .map(|(name, value)| {
            (
                name.to_string(),
                value.to_str().unwrap_or_default().to_string(),
            )
        })
        .collect();
    let body = response
        .bytes()
        .await
        .map_err(|error| error.to_string())?
        .to_vec();

    Ok(ResponseSpec {
        status,
        headers,
        body,
    })
}

/// Credentials are selected in Rust by exact HTTPS origin and never follow redirects.
pub async fn authenticated_send(
    client: &reqwest::Client,
    sessions: &crate::auth::Sessions,
    url: &reqwest::Url,
    request: reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    let token = sessions.token_for(url, client).await?;
    let mut first = request.try_clone().ok_or("Request cannot be retried")?;
    if let Some(token) = &token {
        first = first.bearer_auth(token);
    }
    let response = first
        .send()
        .await
        .map_err(|_| "The server request failed".to_string())?;
    if response.status() != reqwest::StatusCode::UNAUTHORIZED || token.is_none() {
        return Ok(response);
    }
    let fresh = sessions
        .refresh_after_unauthorized(url, client, token.as_deref().unwrap())
        .await?;
    if let Some(fresh) = fresh {
        request
            .bearer_auth(fresh)
            .send()
            .await
            .map_err(|_| "The server request failed".into())
    } else {
        Ok(response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    #[tokio::test]
    async fn request_bridge_filters_credentials_and_does_not_follow_redirects() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1/jobs", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            socket.read(&mut request).await.unwrap();
            socket.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/never-follow\r\nSet-Cookie: secret\r\nAuthorization: secret\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").await.unwrap();
        });
        let response = execute_request(
            RequestSpec {
                url,
                method: "GET".into(),
                headers: vec![],
                body: None,
                timeout_ms: 1000,
            },
            &client().unwrap(),
            &crate::auth::Sessions::default(),
        )
        .await
        .unwrap();
        assert_eq!(response.status, 302);
        assert_eq!(response.body, b"ok");
        assert!(response
            .headers
            .iter()
            .all(|(key, _)| key != "set-cookie" && key != "authorization"));
        assert!(response
            .headers
            .iter()
            .any(|(key, value)| key == "content-type" && value == "text/plain"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn request_bridge_rejects_javascript_credentials_before_networking() {
        for name in ["Authorization", "cookie"] {
            let result = execute_request(
                RequestSpec {
                    url: "https://offline.invalid/v1/jobs".into(),
                    method: "GET".into(),
                    headers: vec![(name.into(), "secret".into())],
                    body: None,
                    timeout_ms: 1000,
                },
                &client().unwrap(),
                &crate::auth::Sessions::default(),
            )
            .await;
            assert_eq!(
                result.err().unwrap(),
                "Credentials must be managed by the native host"
            );
        }
    }

    #[test]
    fn parses_a_method_it_supports() {
        assert_eq!(method_from("POST").unwrap(), reqwest::Method::POST);
    }

    #[test]
    fn rejects_a_method_it_does_not_support() {
        assert!(method_from("TRACE").is_err());
    }
}
