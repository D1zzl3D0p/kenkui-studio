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
        "PATCH" => Ok(reqwest::Method::PATCH),
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
    let url = server_url(&spec.url)?;
    if !url.path().starts_with("/v1/") || url.path().starts_with("/v1/auth/native/") {
        return Err("The request is outside the Kenkui API".into());
    }
    let mut request = client
        .request(method_from(&spec.method)?, url.clone())
        .timeout(Duration::from_millis(spec.timeout_ms.clamp(1_000, 120_000)));
    for (name, value) in &spec.headers {
        if name.eq_ignore_ascii_case("authorization")
            || name.eq_ignore_ascii_case("cookie")
            || name.eq_ignore_ascii_case("host")
        {
            return Err("Credentials must be managed by the native host".into());
        }
        request = request.header(name, value);
    }
    if let Some(body) = spec.body {
        request = request.body(body);
    }

    let response = authenticated_send(client, sessions, &url, request).await?;
    let response = if spec.method.eq_ignore_ascii_case("GET") {
        artifact_redirect(client, &url, response).await?
    } else {
        response
    };
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
        .map_err(|_| "The server response was interrupted")?
        .to_vec();

    Ok(ResponseSpec {
        status,
        headers,
        body,
    })
}

/// Follow one signed storage redirect only for a job artifact. Build a fresh
/// request without the Kenkui Bearer, cookies, referrer or caller headers.
pub async fn artifact_redirect(
    client: &reqwest::Client,
    api: &reqwest::Url,
    response: reqwest::Response,
) -> Result<reqwest::Response, String> {
    let parts: Vec<_> = api.path().split('/').collect();
    if response.status() != reqwest::StatusCode::SEE_OTHER
        || api.scheme() != "https"
        || response.extensions().get::<BearerUsed>().is_none()
        || !matches!(parts.as_slice(), ["", "v1", "jobs", id, "artifact"] if !id.is_empty())
    {
        return Ok(response);
    }
    let location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|h| h.to_str().ok())
        .ok_or("Missing artifact location")?;
    let request = signed_artifact_request(client, location)?;
    let response = client
        .execute(request)
        .await
        .map_err(|_| "Could not open the signed artifact")?;
    check_storage_status(response.status())?;
    Ok(response)
}
fn check_storage_status(status: reqwest::StatusCode) -> Result<(), String> {
    if status.is_redirection() {
        return Err("Unexpected second artifact redirect".into());
    }
    Ok(())
}
fn signed_artifact_request(
    client: &reqwest::Client,
    location: &str,
) -> Result<reqwest::Request, String> {
    let target = server_url(location)?;
    if target.scheme() != "https" || target.fragment().is_some() {
        return Err("Invalid artifact location".into());
    }
    client
        .get(target)
        .build()
        .map_err(|_| "Invalid artifact location".into())
}

/// Credentials are selected in Rust by exact HTTPS origin and never follow redirects.
pub async fn authenticated_send(
    client: &reqwest::Client,
    sessions: &crate::auth::Sessions,
    url: &reqwest::Url,
    request: reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    let token = sessions.token_for(url, client).await?;
    let first = request.try_clone().ok_or("Request cannot be retried")?;
    let response = send_api(first, token.as_deref()).await?;
    let Some(token) = token else {
        return Ok(response);
    };
    if response.status() != reqwest::StatusCode::UNAUTHORIZED {
        return Ok(response);
    }
    match sessions
        .refresh_after_unauthorized(url, client, &token)
        .await?
    {
        Some(fresh) => send_api(request, Some(&fresh)).await,
        None => Ok(response),
    }
}

#[derive(Clone)]
struct BearerUsed;

async fn send_api(
    request: reqwest::RequestBuilder,
    token: Option<&str>,
) -> Result<reqwest::Response, String> {
    let request = if let Some(token) = token {
        request.bearer_auth(token)
    } else {
        request
    };
    let mut response = request
        .send()
        .await
        .map_err(|_| "The server request failed")?;
    if token.is_some() {
        // Private Rust state identifies an authenticated hop without retaining the secret.
        response.extensions_mut().insert(BearerUsed);
    }
    Ok(response)
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

    #[tokio::test]
    async fn only_authenticated_https_job_artifacts_accept_the_303_contract() {
        for (origin, path, token, follow) in [
            (
                "https://api.test",
                "/v1/jobs/book/artifact",
                Some("fixture"),
                true,
            ),
            ("https://api.test", "/v1/jobs/book/artifact", None, false),
            (
                "http://api.test",
                "/v1/jobs/book/artifact",
                Some("fixture"),
                false,
            ),
            ("https://api.test", "/v1/jobs/book", Some("fixture"), false),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/fixture", listener.local_addr().unwrap());
            let reply = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = [0; 4096];
                let n = socket.read(&mut bytes).await.unwrap();
                socket.write_all(b"HTTP/1.1 303 See Other\r\nLocation: /invalid-relative-location\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                String::from_utf8_lossy(&bytes[..n]).to_ascii_lowercase()
            });
            let c = client().unwrap();
            let response = send_api(c.get(url), token).await.unwrap();
            assert_eq!(
                reply
                    .await
                    .unwrap()
                    .contains("authorization: bearer fixture"),
                token.is_some()
            );
            let result =
                artifact_redirect(&c, &format!("{origin}{path}").parse().unwrap(), response).await;
            if follow {
                assert!(result.is_err());
            } else {
                assert_eq!(result.unwrap().status().as_u16(), 303);
            }
        }
    }

    #[test]
    fn signed_artifact_hop_requires_https_and_carries_no_kenkui_headers() {
        let client = client().unwrap();
        let request =
            signed_artifact_request(&client, "https://store.test/book?signature=fixture").unwrap();
        assert!(request.headers().is_empty());
        for redirect in [301, 302, 303, 307, 308] {
            assert!(
                check_storage_status(reqwest::StatusCode::from_u16(redirect).unwrap()).is_err()
            );
        }
        assert!(check_storage_status(reqwest::StatusCode::OK).is_ok());
        assert_eq!(request.method(), reqwest::Method::GET);
        for invalid in [
            "/book",
            "http://store.test/book",
            "file:///book",
            "https://u:p@store.test/book",
            "https://store.test/book#frag",
        ] {
            assert!(signed_artifact_request(&client, invalid).is_err());
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
