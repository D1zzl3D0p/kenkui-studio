use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct RequestSpec {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
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

#[tauri::command]
pub async fn kenkui_request(spec: RequestSpec) -> Result<ResponseSpec, String> {
    let client = reqwest::Client::new();
    let mut request = client.request(method_from(&spec.method)?, &spec.url);
    for (name, value) in &spec.headers {
        request = request.header(name, value);
    }
    if let Some(body) = spec.body {
        request = request.body(body);
    }

    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_str().unwrap_or_default().to_string()))
        .collect();
    let body = response.bytes().await.map_err(|error| error.to_string())?.to_vec();

    Ok(ResponseSpec { status, headers, body })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_method_it_supports() {
        assert_eq!(method_from("POST").unwrap(), reqwest::Method::POST);
    }

    #[test]
    fn rejects_a_method_it_does_not_support() {
        assert!(method_from("TRACE").is_err());
    }
}
