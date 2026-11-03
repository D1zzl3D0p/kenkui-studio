use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::future::{AbortHandle, Abortable};

use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
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

use crate::credential_store::{CredentialStore, Owner, Record, SecretStore};
use crate::oauth::{
    authorities, now, Authorities, Authority, Config, Provider, VerifiedGrant, SCOPES,
};
use std::path::PathBuf;

struct Access {
    credential: RequestCredential,
    refresh: String,
    expires: u64,
}
/// Kept in Rust through a request. A 401 can only replay under this same login.
#[derive(Clone)]
pub struct RequestCredential {
    pub token: String,
    subject: String,
    generation: String,
    config: Config,
}
impl RequestCredential {
    fn belongs_to(&self, record: &Record) -> bool {
        self.generation == record.generation
            && self.subject == record.subject
            && self.config == record.config
    }
}
#[derive(Default)]
struct Slot {
    provider: Option<Provider>,
    access: Option<Access>,
}
type SessionSlot = Arc<Mutex<Slot>>;
#[derive(Clone)]
pub struct Sessions {
    pins: Arc<Result<Authorities, String>>,
    store: Arc<dyn SecretStore>,
    lock_dir: Option<PathBuf>,
    slots: Arc<Mutex<HashMap<String, SessionSlot>>>,
    login: Arc<Mutex<()>>,
    pending: Arc<StdMutex<Option<AbortHandle>>>,
}
impl Default for Sessions {
    fn default() -> Self {
        Self::with_store(
            Arc::new(CredentialStore),
            None,
            option_env!("KENKUI_AUTH_AUTHORITIES").unwrap_or("[]"),
        )
    }
}
impl Sessions {
    fn with_store(
        store: Arc<dyn SecretStore>,
        lock_dir: Option<PathBuf>,
        encoded_pins: &str,
    ) -> Self {
        Self {
            pins: Arc::new(authorities(encoded_pins)),
            store,
            lock_dir,
            slots: Arc::default(),
            login: Arc::default(),
            pending: Arc::default(),
        }
    }
    fn trusted(&self, origin: &str) -> Result<&Authority, String> {
        self.pins
            .as_ref()
            .as_ref()
            .map_err(Clone::clone)?
            .get(origin)
            .ok_or_else(|| {
                "This Studio build does not trust hosted sign-in for this server.".into()
            })
    }
    async fn slot(&self, origin: &str) -> SessionSlot {
        self.slots
            .lock()
            .await
            .entry(origin.into())
            .or_default()
            .clone()
    }
    async fn owner(&self, origin: &str) -> Result<Arc<Owner>, String> {
        let store = self.store.clone();
        let dir = match &self.lock_dir {
            Some(dir) => dir.clone(),
            None => crate::credential_store::lock_dir()?,
        };
        let origin = origin.to_owned();
        tokio::task::spawn_blocking(move || Owner::acquire(&dir, &origin, store).map(Arc::new))
            .await
            .map_err(|_| "Credential lock task failed")?
    }
    async fn install(
        owner: &Arc<Owner>,
        slot: &mut Slot,
        config: Config,
        grant: VerifiedGrant,
        generation: String,
    ) -> Result<(), String> {
        let record = Record {
            api_origin: owner.origin.clone(),
            config,
            generation,
            subject: grant.subject,
            refresh: grant.refresh,
            uncertain: false,
        };
        owner.write(&record).await?;
        slot.access = Some(Access {
            credential: RequestCredential {
                token: grant.access,
                config: record.config,
                subject: record.subject,
                generation: record.generation,
            },
            expires: grant.expires,
            refresh: record.refresh,
        });
        Ok(())
    }
    pub async fn restore(&self, origin: &str, client: &reqwest::Client) -> Result<(), String> {
        let origin = auth_origin(origin)?;
        let slot = self.slot(&origin).await;
        let mut slot = slot.lock().await;
        let owner = self.owner(&origin).await?;
        let previous = slot.provider.take();
        let Some(record) = owner.read().await? else {
            slot.access = None;
            return Ok(());
        };
        let pin = self.trusted(&origin)?;
        if !record.uncertain && pin.trusts(&record.config) {
            let config = Config::load(client, pin).await?;
            if record.config == config {
                slot.provider = Some(
                    previous
                        .filter(|p| p.config == config)
                        .unwrap_or_else(|| Provider::new(config)),
                );
            }
        }
        Ok(())
    }
    async fn access(
        &self,
        origin: &str,
        client: &reqwest::Client,
        used: Option<&RequestCredential>,
    ) -> Result<Option<RequestCredential>, String> {
        let Some(slot) = self.slots.lock().await.get(origin).cloned() else {
            return Ok(None);
        };
        let mut slot = slot.lock().await;
        if slot.provider.is_none() {
            return Ok(None);
        }
        let owner = self.owner(origin).await?;
        let Some(mut record) = owner.read().await? else {
            slot.access = None;
            return Ok(None);
        };
        if record.uncertain
            || !self.trusted(origin)?.trusts(&record.config)
            || slot.provider.as_ref().unwrap().config != record.config
        {
            slot.access = None;
            return Ok(None);
        }
        if used.is_some_and(|original| !original.belongs_to(&record)) {
            return Ok(None);
        }
        if record.generation.is_empty() {
            // Upgrade an earlier v2 entry once, while holding the shared credential lock.
            record.generation = random_secret()?;
            owner.write(&record).await?;
        }
        if let Some(access) = &slot.access {
            if access.expires > now() + 60
                && access.refresh == record.refresh
                && access.credential.belongs_to(&record)
                && used.map(|request| &request.token) != Some(&access.credential.token)
            {
                return Ok(Some(access.credential.clone()));
            }
        }
        let provider = slot.provider.as_mut().unwrap();
        let metadata = provider.discover(client).await?;
        // Persist before sending a potentially one-use credential. Never replay on restart.
        record.uncertain = true;
        owner.write(&record).await?;
        let grant = provider
            .exchange(
                client,
                &metadata.token_endpoint,
                &[
                    ("grant_type", "refresh_token"),
                    ("refresh_token", &record.refresh),
                ],
            )
            .await;
        let grant = match grant {
            Ok(grant) if grant.subject == record.subject => grant,
            _ => {
                slot.access = None;
                return Ok(None);
            }
        };
        Self::install(&owner, &mut slot, record.config, grant, record.generation).await?;
        Ok(slot.access.as_ref().map(|a| a.credential.clone()))
    }
    pub async fn token_for(
        &self,
        url: &reqwest::Url,
        client: &reqwest::Client,
    ) -> Result<Option<RequestCredential>, String> {
        if url.scheme() != "https"
            || !url.path().starts_with("/v1/")
            || url.path().starts_with("/v1/auth/native/")
            || url.path() == "/v1/capabilities"
        {
            return Ok(None);
        }
        self.access(&url.origin().ascii_serialization(), client, None)
            .await
    }
    pub async fn refresh_after_unauthorized(
        &self,
        url: &reqwest::Url,
        client: &reqwest::Client,
        used: &RequestCredential,
    ) -> Result<Option<RequestCredential>, String> {
        self.access(&url.origin().ascii_serialization(), client, Some(used))
            .await
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
        self.sign_in_with(&origin, SIGN_IN_TIMEOUT, async {
            let config = Config::load(client, self.trusted(&origin)?).await?;
            let mut provider = Provider::new(config);
            let grant = browser_grant(&mut provider, client, open).await?;
            Ok((provider, grant))
        })
        .await
    }
    async fn sign_in_with(
        &self,
        origin: &str,
        timeout: Duration,
        grant: impl std::future::Future<Output = Result<(Provider, VerifiedGrant), String>>,
    ) -> Result<(), String> {
        let (abort, registration) = AbortHandle::new_pair();
        let _login = {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| "Sign-in state unavailable")?;
            let login = self
                .login
                .try_lock()
                .map_err(|_| "A sign-in is already in progress")?;
            *pending = Some(abort);
            login
        };
        // Registration precedes every await, including lock acquisition and discovery.
        let start = async {
            let slot = self.slot(origin).await.lock_owned().await;
            let owner = self.owner(origin).await?;
            let (provider, grant) = grant.await?;
            Ok::<_, String>((slot, owner, provider, grant))
        };
        let result = Abortable::new(tokio::time::timeout(timeout, start), registration).await;
        *self
            .pending
            .lock()
            .map_err(|_| "Sign-in state unavailable")? = None;
        let (mut slot, owner, provider, grant) = result
            .map_err(|_| "Sign-in cancelled")?
            .map_err(|_| "Sign-in timed out; please try again")??;
        Self::install(
            &owner,
            &mut slot,
            provider.config.clone(),
            grant,
            random_secret()?,
        )
        .await?;
        slot.provider = Some(provider);
        Ok(())
    }
    pub async fn sign_out(&self, origin: &str, client: &reqwest::Client) -> Result<bool, String> {
        let origin = auth_origin(origin)?;
        self.cancel();
        let _login = self.login.lock().await;
        let slot = self.slot(&origin).await;
        let mut slot = slot.lock().await;
        let owner = self.owner(&origin).await?;
        let revoked = match owner.read().await {
            Ok(Some(record)) => {
                // Reuse validated live config, or bootstrap against the pin on cold logout.
                let revoke = async {
                    let pin = self.trusted(&origin)?;
                    if !pin.trusts(&record.config) {
                        return Err("Saved sign-in authority changed".to_string());
                    }
                    let mut provider =
                        match slot.provider.take().filter(|p| p.config == record.config) {
                            Some(provider) => provider,
                            None => Provider::new(Config::load(client, pin).await?),
                        };
                    provider.revoke(client, &record.refresh).await
                };
                revoke.await.is_ok()
            }
            Ok(None) => true,
            Err(_) => false,
        };
        owner.clear().await?;
        *slot = Slot::default();
        Ok(revoked)
    }
}

async fn browser_grant(
    provider: &mut Provider,
    client: &reqwest::Client,
    open: impl FnOnce(&str) -> Result<(), String>,
) -> Result<VerifiedGrant, String> {
    let listener = TcpListener::bind("127.0.0.1:43827").await.map_err(|_| {
        "Could not open the sign-in callback. Close any other Kenkui sign-in and retry"
    })?;
    let metadata = provider.discover(client).await?;
    let state = random_secret()?;
    let verifier = random_secret()?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut authorize = reqwest::Url::parse(&metadata.authorization_endpoint)
        .map_err(|_| "Invalid authorize endpoint")?;
    authorize
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &provider.config.client_id)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("scope", SCOPES)
        .append_pair("resource", &provider.config.resource)
        .append_pair("code_challenge_method", "S256")
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
            .and_then(|request| callback_code(request, &state, &provider.config.issuer));
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
        return provider
            .exchange(
                client,
                &metadata.token_endpoint,
                &[
                    ("grant_type", "authorization_code"),
                    ("code", &code),
                    ("code_verifier", &verifier),
                    ("redirect_uri", REDIRECT_URI),
                ],
            )
            .await;
    }
}

/// Invalid/foreign callbacks do not consume the active login attempt.
fn callback_code(request: &str, expected: &str, issuer: &str) -> Option<Result<String, String>> {
    let mut lines = request.split("\r\n");
    let mut request_line = lines.next()?.split_whitespace();
    if request_line.next()? != "GET" {
        return None;
    }
    let target = request_line.next()?;
    if request_line.next()? != "HTTP/1.1"
        || request_line.next().is_some()
        || target.contains('#')
        || !target.starts_with("/callback?")
    {
        return None;
    }
    let mut hosts = lines
        .take_while(|line| !line.is_empty())
        .filter_map(|line| line.split_once(':'))
        .filter(|(name, _)| name.eq_ignore_ascii_case("host"));
    if hosts.next()?.1.trim() != "127.0.0.1:43827" || hosts.next().is_some() {
        return None;
    }
    let url = reqwest::Url::parse(&format!("http://127.0.0.1:43827{target}")).ok()?;
    let pairs: Vec<_> = url.query_pairs().collect();
    let mut seen = std::collections::HashSet::new();
    if pairs.iter().any(|(name, _)| !seen.insert(name.as_ref()))
        || !pairs
            .iter()
            .any(|(name, value)| name == "iss" && value == issuer)
    {
        return None;
    }
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
#[path = "auth_tests.rs"]
mod tests;
