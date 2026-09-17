use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::future::{AbortHandle, Abortable};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex as StdMutex},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::Mutex,
};

pub const REDIRECT_URI: &str = "http://127.0.0.1:43827/callback";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(180);

pub fn verifier_is_valid(verifier: &str) -> bool {
    (43..=128).contains(&verifier.len())
        && verifier
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-._~".contains(&c))
}

fn random_secret() -> Result<String, String> {
    let mut bytes = [0; 32];
    getrandom::getrandom(&mut bytes).map_err(|_| "Secure randomness is unavailable")?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub fn auth_origin(value: &str) -> Result<String, String> {
    let url = crate::http::server_url(value)?;
    if url.scheme() != "https"
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Native sign-in requires an HTTPS server origin".into());
    }
    Ok(url.origin().ascii_serialization())
}

trait SecretStore: Send + Sync {
    fn read(&self, origin: &str) -> Result<Option<String>, String>;
    fn write(&self, origin: &str, secret: &str) -> Result<(), String>;
    fn remove(&self, origin: &str) -> Result<(), String>;
}

struct CredentialStore;
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
fn entry(origin: &str) -> Result<keyring::Entry, String> {
    let account = URL_SAFE_NO_PAD.encode(Sha256::digest(origin.as_bytes()));
    keyring::Entry::new("org.kenkui.studio.refresh", &account)
        .map_err(|_| "The OS credential store is unavailable".into())
}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
impl SecretStore for CredentialStore {
    fn read(&self, origin: &str) -> Result<Option<String>, String> {
        match entry(origin)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Could not read the OS credential store".into()),
        }
    }
    fn write(&self, origin: &str, secret: &str) -> Result<(), String> {
        entry(origin)?
            .set_password(secret)
            .map_err(|_| "Could not save the session in the OS credential store".into())
    }
    fn remove(&self, origin: &str) -> Result<(), String> {
        match entry(origin)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("Could not remove the session from the OS credential store".into()),
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
impl SecretStore for CredentialStore {
    fn read(&self, _: &str) -> Result<Option<String>, String> {
        Err("Mobile sign-in is not available yet".into())
    }
    fn write(&self, _: &str, _: &str) -> Result<(), String> {
        Err("Mobile sign-in is not available yet".into())
    }
    fn remove(&self, _: &str) -> Result<(), String> {
        Err("Mobile sign-in is not available yet".into())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Grant {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
}

struct Session {
    access: String,
    refresh: String,
    expires: Instant,
}

type SessionSlot = Arc<Mutex<Option<Session>>>;
#[derive(Clone)]
pub struct Sessions {
    store: Arc<dyn SecretStore>,
    slots: Arc<Mutex<HashMap<String, SessionSlot>>>,
    login: Arc<Mutex<()>>,
    pending: Arc<StdMutex<Option<AbortHandle>>>,
}

impl Default for Sessions {
    fn default() -> Self {
        Self::with_store(Arc::new(CredentialStore))
    }
}

impl Sessions {
    fn with_store(store: Arc<dyn SecretStore>) -> Self {
        Self {
            store,
            slots: Arc::default(),
            login: Arc::default(),
            pending: Arc::default(),
        }
    }
    async fn slot(&self, origin: &str) -> SessionSlot {
        self.slots
            .lock()
            .await
            .entry(origin.into())
            .or_default()
            .clone()
    }
    async fn read_secret(&self, origin: &str) -> Result<Option<String>, String> {
        let store = self.store.clone();
        let origin = origin.to_string();
        tokio::task::spawn_blocking(move || store.read(&origin))
            .await
            .map_err(|_| "Credential task failed")?
    }
    async fn remove_secret(&self, origin: &str) -> Result<(), String> {
        let store = self.store.clone();
        let origin = origin.to_string();
        tokio::task::spawn_blocking(move || store.remove(&origin))
            .await
            .map_err(|_| "Credential task failed")?
    }
    async fn install(
        &self,
        origin: &str,
        grant: Grant,
        session: &mut Option<Session>,
    ) -> Result<(), String> {
        if grant.access_token.is_empty()
            || grant.refresh_token.is_empty()
            || !(1..=86400).contains(&grant.expires_in)
        {
            return Err("The server returned an invalid native session".into());
        }
        let store = self.store.clone();
        let account = origin.to_string();
        let secret = grant.refresh_token.clone();
        tokio::task::spawn_blocking(move || store.write(&account, &secret))
            .await
            .map_err(|_| "Credential task failed")??;
        *session = Some(Session {
            access: grant.access_token,
            refresh: grant.refresh_token,
            expires: Instant::now() + Duration::from_secs(grant.expires_in.saturating_sub(30)),
        });
        Ok(())
    }
    async fn refresh(
        &self,
        origin: &str,
        client: &reqwest::Client,
        secret: String,
        session: &mut Option<Session>,
    ) -> Result<(), String> {
        let response = client
            .post(format!("{origin}/v1/auth/native/refresh"))
            .timeout(Duration::from_secs(15))
            .json(&serde_json::json!({"refreshToken": secret}))
            .send()
            .await
            .map_err(|_| "Could not refresh the session; check your connection")?;
        if matches!(response.status().as_u16(), 401 | 403) {
            *session = None;
            self.remove_secret(origin).await?;
            return Ok(());
        }
        let grant = read_grant(response).await?;
        self.install(origin, grant, session).await
    }
    pub async fn restore(&self, origin: &str, client: &reqwest::Client) -> Result<(), String> {
        let origin = auth_origin(origin)?;
        let slot = self.slot(&origin).await;
        let mut session = slot.lock().await;
        if session.as_ref().is_some_and(|s| s.expires > Instant::now()) {
            return Ok(());
        }
        let refresh = match session.as_ref() {
            Some(s) => Some(s.refresh.clone()),
            None => self.read_secret(&origin).await?,
        };
        if let Some(refresh) = refresh {
            self.refresh(&origin, client, refresh, &mut session).await?;
        }
        Ok(())
    }
    pub async fn token_for(
        &self,
        url: &reqwest::Url,
        client: &reqwest::Client,
    ) -> Result<Option<String>, String> {
        if url.scheme() != "https"
            || !url.path().starts_with("/v1/")
            || url.path().starts_with("/v1/auth/native/")
        {
            return Ok(None);
        }
        let origin = url.origin().ascii_serialization();
        let slot = self.slots.lock().await.get(&origin).cloned();
        let Some(slot) = slot else {
            return Ok(None);
        };
        let mut session = slot.lock().await;
        if let Some(s) = session.as_ref() {
            if s.expires <= Instant::now() {
                self.refresh(&origin, client, s.refresh.clone(), &mut session)
                    .await?;
            }
        }
        Ok(session.as_ref().map(|s| s.access.clone()))
    }
    pub async fn refresh_after_unauthorized(
        &self,
        url: &reqwest::Url,
        client: &reqwest::Client,
        used: &str,
    ) -> Result<Option<String>, String> {
        let origin = url.origin().ascii_serialization();
        let slot = self.slot(&origin).await;
        let mut session = slot.lock().await;
        if let Some(s) = session.as_ref() {
            // Another request may already have rotated the one-use refresh token.
            if s.access == used {
                self.refresh(&origin, client, s.refresh.clone(), &mut session)
                    .await?;
            }
        }
        Ok(session.as_ref().map(|s| s.access.clone()))
    }
    pub fn cancel(&self) {
        if let Ok(mut pending) = self.pending.lock() {
            if let Some(abort) = pending.take() {
                abort.abort();
            }
        }
    }
    pub async fn sign_in(
        &self,
        origin: &str,
        client: &reqwest::Client,
        open: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        let origin = auth_origin(origin)?;
        let _login = self
            .login
            .try_lock()
            .map_err(|_| "A sign-in is already in progress")?;
        let (abort, registration) = AbortHandle::new_pair();
        *self
            .pending
            .lock()
            .map_err(|_| "Sign-in state is unavailable")? = Some(abort);
        let result = Abortable::new(
            tokio::time::timeout(SIGN_IN_TIMEOUT, browser_grant(&origin, client, open)),
            registration,
        )
        .await;
        *self
            .pending
            .lock()
            .map_err(|_| "Sign-in state is unavailable")? = None;
        let grant = result
            .map_err(|_| "Sign-in cancelled")?
            .map_err(|_| "Sign-in timed out; please try again")??;
        // Persist outside the cancellable future. Logout waits for this write.
        let slot = self.slot(&origin).await;
        let mut session = slot.lock().await;
        self.install(&origin, grant, &mut session).await
    }
    pub async fn sign_out(&self, origin: &str, client: &reqwest::Client) -> Result<(), String> {
        let origin = auth_origin(origin)?;
        self.cancel();
        let _login = self.login.lock().await;
        let slot = self.slot(&origin).await;
        let mut session = slot.lock().await;
        // Restore once to revoke a session even after restarting the app.
        if session.is_none() {
            if let Some(secret) = self.read_secret(&origin).await? {
                let _ = self.refresh(&origin, client, secret, &mut session).await;
            }
        }
        let token = session.as_ref().map(|s| s.access.clone());
        self.remove_secret(&origin).await?;
        *session = None;
        if let Some(token) = token {
            // Local sign-out still succeeds offline; server revocation is best effort.
            let _ = client
                .post(format!("{origin}/v1/auth/native/logout"))
                .timeout(Duration::from_secs(10))
                .bearer_auth(token)
                .send()
                .await;
        }
        Ok(())
    }
}

async fn read_grant(response: reqwest::Response) -> Result<Grant, String> {
    match response.status().as_u16() {
        200 => response
            .json()
            .await
            .map_err(|_| "The server returned an invalid native session".into()),
        401 => Err("Your session has expired. Please sign in again".into()),
        403 => Err("Sign in with an invited account to continue".into()),
        404 => Err("Native sign-in is not enabled on this server".into()),
        _ => Err("The authentication service is unavailable; please try again".into()),
    }
}

async fn browser_grant(
    origin: &str,
    client: &reqwest::Client,
    open: impl FnOnce(&str) -> Result<(), String>,
) -> Result<Grant, String> {
    let response = client
        .get(format!("{origin}/v1/auth/native/config"))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| "Could not contact the sign-in service")?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("Native sign-in is not enabled on this server".into());
    }
    if !response.status().is_success() {
        return Err("The sign-in service is unavailable".into());
    }
    let config: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Invalid native sign-in configuration")?;
    if config["redirectUri"].as_str() != Some(REDIRECT_URI) {
        return Err("This server requires an unsupported sign-in callback".into());
    }
    let listener = TcpListener::bind("127.0.0.1:43827").await.map_err(|_| {
        "Could not open the sign-in callback. Close any other Kenkui sign-in and retry"
    })?;
    let state = random_secret()?;
    let verifier = random_secret()?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut authorize = reqwest::Url::parse(&format!("{origin}/v1/auth/native/authorize")).unwrap();
    authorize
        .query_pairs_mut()
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge);
    open(authorize.as_str())?;
    loop {
        let (mut socket, _) = listener
            .accept()
            .await
            .map_err(|_| "Sign-in callback failed")?;
        let request = tokio::time::timeout(Duration::from_secs(5), async {
            let mut bytes = Vec::new();
            let mut chunk = [0; 1024];
            while bytes.len() < 8192 {
                let count = socket.read(&mut chunk).await.ok()?;
                if count == 0 {
                    return None;
                }
                bytes.extend_from_slice(&chunk[..count]);
                if bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                    return String::from_utf8(bytes).ok();
                }
            }
            None
        })
        .await
        .ok()
        .flatten();
        let callback = request
            .as_deref()
            .and_then(|request| callback_code(request, &state));
        let Some(code) = callback else {
            let _ = socket
                .write_all(
                    b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
            continue;
        };
        let message = b"Sign-in received. Return to Kenkui Studio to continue.";
        let header = format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", message.len());
        let _ = socket.write_all(header.as_bytes()).await;
        let _ = socket.write_all(message).await;
        let _ = socket.shutdown().await;
        let code = code?;
        let response = client
            .post(format!("{origin}/v1/auth/native/exchange"))
            .timeout(Duration::from_secs(15))
            .json(&serde_json::json!({"code": code, "codeVerifier": verifier}))
            .send()
            .await
            .map_err(|_| "Could not complete sign-in; please try again")?;
        return read_grant(response).await;
    }
}

/// Invalid/foreign callbacks do not consume the active login attempt.
fn callback_code(request: &str, expected: &str) -> Option<Result<String, String>> {
    let mut lines = request.split("\r\n");
    let mut request_line = lines.next()?.split_whitespace();
    if request_line.next()? != "GET" {
        return None;
    }
    let target = request_line.next()?;
    if !target.starts_with("/callback?") {
        return None;
    }
    let host = lines
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("host"))?
        .1
        .trim();
    if host != "127.0.0.1:43827" {
        return None;
    }
    let url = reqwest::Url::parse(&format!("http://127.0.0.1:43827{target}")).ok()?;
    let pairs: Vec<_> = url.query_pairs().collect();
    let states: Vec<_> = pairs.iter().filter(|(name, _)| name == "state").collect();
    if states.len() != 1 || states[0].1 != expected {
        return None;
    }
    let codes: Vec<_> = pairs.iter().filter(|(name, _)| name == "code").collect();
    let errors = pairs.iter().any(|(name, _)| name == "error");
    if errors && codes.is_empty() {
        return Some(Err("Sign-in was declined or cancelled".into()));
    }
    if codes.len() != 1 || errors || codes[0].1.is_empty() || codes[0].1.len() > 4096 {
        return None;
    }
    Some(Ok(codes[0].1.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct MemoryStore(StdMutex<HashMap<String, String>>);
    impl SecretStore for MemoryStore {
        fn read(&self, origin: &str) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().get(origin).cloned())
        }
        fn write(&self, origin: &str, secret: &str) -> Result<(), String> {
            self.0.lock().unwrap().insert(origin.into(), secret.into());
            Ok(())
        }
        fn remove(&self, origin: &str) -> Result<(), String> {
            self.0.lock().unwrap().remove(origin);
            Ok(())
        }
    }
    async fn cached(sessions: &Sessions, origin: &str, access: &str, lifetime: u64) {
        let slot = sessions.slot(origin).await;
        sessions
            .install(
                origin,
                Grant {
                    access_token: access.into(),
                    refresh_token: "refresh".into(),
                    expires_in: lifetime,
                },
                &mut *slot.lock().await,
            )
            .await
            .unwrap();
    }
    fn callback(query: &str) -> String {
        format!("GET /callback?{query} HTTP/1.1\r\nHost: 127.0.0.1:43827\r\n\r\n")
    }
    #[test]
    fn creates_valid_pkce_and_matches_rfc_challenge() {
        assert!(verifier_is_valid(&random_secret().unwrap()));
        assert!(!verifier_is_valid("short"));
        assert!(!verifier_is_valid(&"!".repeat(43)));
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(
                b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
            )),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
    #[test]
    fn callbacks_require_exact_state_host_path_and_unambiguous_code() {
        assert_eq!(
            callback_code(&callback("state=expected&code=ok"), "expected"),
            Some(Ok("ok".into()))
        );
        for query in [
            "state=wrong&code=ok",
            "state=expected&state=expected&code=ok",
            "state=expected&code=a&code=b",
            "state=expected&code=a&error=denied",
        ] {
            assert_eq!(callback_code(&callback(query), "expected"), None);
        }
        assert_eq!(
            callback_code(&callback("state=expected&error=denied"), "expected"),
            Some(Err("Sign-in was declined or cancelled".into()))
        );
        assert_eq!(
            callback_code(
                &callback("state=expected&code=ok")
                    .replace("Host: 127.0.0.1:43827", "Host: attacker.test"),
                "expected"
            ),
            None
        );
        assert_eq!(
            callback_code(
                &callback("state=expected&code=ok").replace("/callback?", "/other?"),
                "expected"
            ),
            None
        );
    }
    #[test]
    fn rejects_insecure_and_ambiguous_auth_origins() {
        for origin in [
            "http://example.com",
            "https://user:pass@example.com",
            "https://example.com/path",
            "https://example.com?query",
            "https://example.com/#fragment",
        ] {
            assert!(auth_origin(origin).is_err());
        }
        assert_eq!(
            auth_origin("https://EXAMPLE.COM:443/").unwrap(),
            "https://example.com"
        );
    }
    #[tokio::test]
    async fn credentials_are_isolated_by_origin_and_only_refresh_secret_is_persisted() {
        let store = Arc::new(MemoryStore::default());
        let sessions = Sessions::with_store(store.clone());
        let client = crate::http::client().unwrap();
        cached(&sessions, "https://api.test", "private-access", 300).await;
        assert_eq!(
            store.read("https://api.test").unwrap(),
            Some("refresh".into())
        );
        let trusted = reqwest::Url::parse("https://api.test/v1/jobs").unwrap();
        assert_eq!(
            sessions.token_for(&trusted, &client).await.unwrap(),
            Some("private-access".into())
        );
        for address in [
            "https://other.test/v1/jobs",
            "http://api.test/v1/jobs",
            "https://api.test:444/v1/jobs",
            "https://api.test/unrelated",
            "https://api.test/v1/auth/native/config",
        ] {
            assert_eq!(
                sessions
                    .token_for(&reqwest::Url::parse(address).unwrap(), &client)
                    .await
                    .unwrap(),
                None
            );
        }
    }

    async fn mock_refresh(status: u16) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = vec![0; 8192];
            let count = socket.read(&mut bytes).await.unwrap();
            let request = String::from_utf8_lossy(&bytes[..count]).to_string();
            let body =
                r#"{"accessToken":"new-access","refreshToken":"rotated-refresh","expiresIn":300}"#;
            let response = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            socket.write_all(response.as_bytes()).await.unwrap();
            request
        });
        (origin, task)
    }
    #[tokio::test]
    async fn concurrent_unauthorized_requests_rotate_the_refresh_token_only_once() {
        let (origin, task) = mock_refresh(200).await;
        let store = Arc::new(MemoryStore::default());
        let sessions = Sessions::with_store(store.clone());
        cached(&sessions, &origin, "old-access", 300).await;
        let url = reqwest::Url::parse(&format!("{origin}/v1/jobs")).unwrap();
        let client = crate::http::client().unwrap();
        let (one, two) = tokio::join!(
            sessions.refresh_after_unauthorized(&url, &client, "old-access"),
            sessions.refresh_after_unauthorized(&url, &client, "old-access"),
        );
        assert_eq!(one.unwrap(), Some("new-access".into()));
        assert_eq!(two.unwrap(), Some("new-access".into()));
        assert_eq!(store.read(&origin).unwrap(), Some("rotated-refresh".into()));
        assert!(task
            .await
            .unwrap()
            .starts_with("POST /v1/auth/native/refresh"));
    }
    #[tokio::test]
    async fn rejected_refresh_clears_credentials_but_provider_outage_preserves_them() {
        for status in [401, 403, 503] {
            let (origin, task) = mock_refresh(status).await;
            let store = Arc::new(MemoryStore::default());
            let sessions = Sessions::with_store(store.clone());
            cached(&sessions, &origin, "old-access", 300).await;
            let url = reqwest::Url::parse(&format!("{origin}/v1/jobs")).unwrap();
            let result = sessions
                .refresh_after_unauthorized(&url, &crate::http::client().unwrap(), "old-access")
                .await;
            if status == 503 {
                assert!(result.is_err());
                assert_eq!(store.read(&origin).unwrap(), Some("refresh".into()));
            } else {
                assert_eq!(result.unwrap(), None);
                assert_eq!(store.read(&origin).unwrap(), None);
            }
            task.await.unwrap();
        }
    }
    #[tokio::test]
    async fn fresh_install_without_credentials_does_not_contact_the_auth_server() {
        let sessions = Sessions::with_store(Arc::new(MemoryStore::default()));
        sessions
            .restore("https://offline.invalid", &crate::http::client().unwrap())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn offline_sign_out_removes_saved_and_memory_credentials() {
        let store = Arc::new(MemoryStore::default());
        let sessions = Sessions::with_store(store.clone());
        let origin = "https://127.0.0.1:1";
        cached(&sessions, origin, "access", 300).await;
        let client = crate::http::client().unwrap();
        sessions.sign_out(origin, &client).await.unwrap();
        assert_eq!(store.read(origin).unwrap(), None);
        assert_eq!(
            sessions
                .token_for(
                    &reqwest::Url::parse(&format!("{origin}/v1/jobs")).unwrap(),
                    &client
                )
                .await
                .unwrap(),
            None
        );
        sessions.restore(origin, &client).await.unwrap();
    }
}
