use super::*;
use crate::oauth::fixture::*;
use std::sync::atomic::{AtomicBool, Ordering};
#[derive(Default)]
struct MemoryStore {
    values: StdMutex<HashMap<String, String>>,
    fail_marker: AtomicBool,
    fail_replacement: AtomicBool,
}
impl SecretStore for MemoryStore {
    fn read(&self, origin: &str) -> Result<Option<String>, String> {
        Ok(self.values.lock().unwrap().get(origin).cloned())
    }
    fn write(&self, origin: &str, secret: &str) -> Result<(), String> {
        let record: Record = serde_json::from_str(secret).unwrap();
        if (record.uncertain && self.fail_marker.load(Ordering::SeqCst))
            || (!record.uncertain && self.fail_replacement.load(Ordering::SeqCst))
        {
            return Err("synthetic storage failure".into());
        }
        self.values
            .lock()
            .unwrap()
            .insert(origin.into(), secret.into());
        Ok(())
    }
    fn remove(&self, origin: &str) -> Result<(), String> {
        self.values.lock().unwrap().remove(origin);
        Ok(())
    }
}
fn callback(query: &str) -> String {
    format!("GET /callback?{query} HTTP/1.1\r\nHost: 127.0.0.1:43827\r\n\r\n")
}
#[test]
fn rejects_callbacks_missing_the_branch_issuer() {
    let valid = format!("state=expected&code=ok&iss={ISSUER}");
    assert_eq!(
        callback_code(&callback(&valid), "expected", ISSUER),
        Some(Ok("ok".into()))
    );
    for query in [
        "code=ok&state=expected".into(),
        valid.replace(ISSUER, "other"),
        format!("{valid}&state=expected"),
        format!("{valid}&iss={ISSUER}"),
        format!("{valid}&code=ok"),
        format!("{valid}#fragment"),
        format!("{valid}&error=denied"),
        valid.replace("expected", "other"),
    ] {
        assert!(callback_code(&callback(&query), "expected", ISSUER).is_none());
    }
    for bad in [
        callback(&valid).replace("43827", "43828"),
        callback(&valid).replace("/callback?", "/other?"),
        callback(&valid).replace("HTTP/1.1\r\n", "HTTP/1.1\r\nHost: other\r\n"),
    ] {
        assert!(callback_code(&bad, "expected", ISSUER).is_none());
    }
    assert!(callback_code(
        &callback(&format!("state=expected&iss={ISSUER}&error=denied")),
        "expected",
        ISSUER
    )
    .unwrap()
    .is_err());
}
#[test]
fn secure_origins_and_pkce() {
    for bad in [
        "http://example.com",
        "https://u:p@example.com",
        "https://example.com/path",
        "https://example.com?x",
        "https://example.com/#x",
    ] {
        assert!(auth_origin(bad).is_err());
    }
    assert!(verifier_is_valid(&random_secret().unwrap()));
    assert_eq!(
        URL_SAFE_NO_PAD.encode(Sha256::digest(
            b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        )),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
}
async fn prepared(endpoint: &str) -> (Sessions, Arc<MemoryStore>, tempfile::TempDir) {
    let temp = tempfile::tempdir().unwrap();
    let store = Arc::new(MemoryStore::default());
    let sessions = Sessions::with_store(store.clone(), Some(temp.path().into()));
    let slot = sessions.slot(ORIGIN).await;
    let mut slot = slot.lock().await;
    slot.provider = Some(provider(endpoint));
    Sessions::install(
        &sessions.owner(ORIGIN).await.unwrap(),
        &mut slot,
        config(),
        VerifiedGrant {
            access: "old-access".into(),
            refresh: "old-refresh".into(),
            subject: "owner".into(),
            expires: now() + 300,
        },
    )
    .await
    .unwrap();
    (sessions, store, temp)
}
async fn response(listener: TcpListener, store: Arc<MemoryStore>, body: String) -> String {
    let (mut socket, _) = listener.accept().await.unwrap();
    let mut buffer = vec![0; 16384];
    let count = socket.read(&mut buffer).await.unwrap();
    assert!(
        serde_json::from_str::<Record>(&store.read(ORIGIN).unwrap().unwrap())
            .unwrap()
            .uncertain
    );
    let reply=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
    socket.write_all(reply.as_bytes()).await.unwrap();
    String::from_utf8(buffer[..count].to_vec()).unwrap()
}
fn grant(subject: &str) -> String {
    let mut c = claims();
    c["sub"] = subject.into();
    serde_json::json!({"access_token":token(c),"refresh_token":"rotated","token_type":"Bearer"})
        .to_string()
}
#[tokio::test]
async fn concurrent_401_uses_one_rotation_and_scopes_credentials() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (sessions, store, _dir) =
        prepared(&format!("http://{}/token", listener.local_addr().unwrap())).await;
    let client = crate::http::client().unwrap();
    for url in [
        "http://api.test/v1/jobs",
        "https://other.test/v1/jobs",
        "https://api.test/other",
        "https://api.test/v1/auth/native/config",
    ] {
        assert!(sessions
            .token_for(&url.parse().unwrap(), &client)
            .await
            .unwrap()
            .is_none());
    }
    let send = tokio::spawn(response(listener, store.clone(), grant("owner")));
    let url = format!("{ORIGIN}/v1/jobs").parse().unwrap();
    let (one, two) = tokio::join!(
        sessions.refresh_after_unauthorized(&url, &client, "old-access"),
        sessions.refresh_after_unauthorized(&url, &client, "old-access")
    );
    let one = one.unwrap().unwrap();
    assert_eq!(Some(one.clone()), two.unwrap());
    assert_ne!(one, "old-access");
    let request = send.await.unwrap();
    for field in [
        "POST /token",
        "grant_type=refresh_token",
        "refresh_token=old-refresh",
        "client_id=desktop-public",
        "resource=https%3A%2F%2Fapi.test",
    ] {
        assert!(request.contains(field));
    }
    let saved = store.read(ORIGIN).unwrap().unwrap();
    assert!(!saved.contains(&one));
    assert!(saved.contains("rotated"));
}
#[tokio::test]
async fn uncertain_rotation_survives_restart_and_cannot_replay() {
    for (body, fail_write) in [
        (String::new(), false),
        (grant("other"), false),
        (grant("owner"), true),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (sessions, store, dir) =
            prepared(&format!("http://{}/token", listener.local_addr().unwrap())).await;
        store.fail_replacement.store(fail_write, Ordering::SeqCst);
        let send = tokio::spawn(response(listener, store.clone(), body));
        let client = crate::http::client().unwrap();
        let url = format!("{ORIGIN}/v1/jobs").parse().unwrap();
        assert!(sessions
            .refresh_after_unauthorized(&url, &client, "old-access")
            .await
            .ok()
            .flatten()
            .is_none());
        send.await.unwrap();
        let restarted = Sessions::with_store(store.clone(), Some(dir.path().into()));
        restarted.restore(ORIGIN, &client).await.unwrap();
        assert!(restarted.token_for(&url, &client).await.unwrap().is_none());
        assert!(
            serde_json::from_str::<Record>(&store.read(ORIGIN).unwrap().unwrap())
                .unwrap()
                .uncertain
        );
    }
}
#[tokio::test]
async fn marker_failure_prevents_post_and_fresh_install_skips_network() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (sessions, store, _dir) =
        prepared(&format!("http://{}/token", listener.local_addr().unwrap())).await;
    store.fail_marker.store(true, Ordering::SeqCst);
    let client = crate::http::client().unwrap();
    let url = format!("{ORIGIN}/v1/jobs").parse().unwrap();
    assert!(sessions
        .refresh_after_unauthorized(&url, &client, "old-access")
        .await
        .is_err());
    assert!(
        tokio::time::timeout(Duration::from_millis(40), listener.accept())
            .await
            .is_err()
    );
    sessions
        .restore("https://offline.invalid", &client)
        .await
        .unwrap();
}

#[test]
fn os_lock_child() {
    let Some(dir) = std::env::var_os("KENKUI_TEST_EXCLUSIVE_LOCK_DIR") else {
        return;
    };
    let dir = std::path::PathBuf::from(dir);
    std::fs::write(dir.join("started"), "").unwrap();
    let _owner = Owner::acquire(&dir, ORIGIN, Arc::new(MemoryStore::default())).unwrap();
    std::fs::write(dir.join("entered"), "").unwrap();
}
#[test]
fn separate_processes_cannot_own_the_same_credential_at_once() {
    let dir = tempfile::tempdir().unwrap();
    let guard = Owner::acquire(dir.path(), ORIGIN, Arc::new(MemoryStore::default())).unwrap();
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "auth::tests::os_lock_child"])
        .env("KENKUI_TEST_EXCLUSIVE_LOCK_DIR", dir.path())
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let start = std::time::Instant::now();
    while !dir.path().join("started").exists() {
        assert!(start.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(10));
    }
    std::thread::sleep(Duration::from_millis(50));
    assert!(!dir.path().join("entered").exists());
    drop(guard);
    assert!(child.wait().unwrap().success());
    assert!(dir.path().join("entered").exists());
}

#[tokio::test]
async fn real_loopback_pkce_and_attempt_cleanup() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/token", listener.local_addr().unwrap());
    let client = crate::http::client().unwrap();
    let mut p = provider(&endpoint);
    let occupied = TcpListener::bind("127.0.0.1:43827").await.unwrap();
    assert!(
        browser_grant(&mut p, &client, |_| panic!("browser opened before binding"))
            .await
            .is_err()
    );
    drop(occupied);
    assert!(
        browser_grant(&mut p, &client, |_| Err("browser unavailable".into()))
            .await
            .is_err()
    );
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buffer = vec![0; 16384];
        let count = socket.read(&mut buffer).await.unwrap();
        let request = String::from_utf8(buffer[..count].to_vec()).unwrap();
        let body = grant("owner");
        socket
            .write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        request
    });
    let mut challenge = String::new();
    let granted = browser_grant(&mut p, &client, |authorize| {
        let url = reqwest::Url::parse(authorize).unwrap();
        let q: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["scope"], SCOPES);
        assert_eq!(q["redirect_uri"], REDIRECT_URI);
        assert_eq!(q["resource"], ORIGIN);
        challenge = q["code_challenge"].clone();
        tokio::spawn(async move {
            for (iss, expected) in [("other", 400), (ISSUER, 200)] {
                let uri = format!("{REDIRECT_URI}?code=code&state={}&iss={iss}", q["state"]);
                let response = reqwest::get(&uri).await.unwrap();
                assert_eq!(response.status().as_u16(), expected);
            }
        });
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(granted.subject, "owner");
    let request = server.await.unwrap();
    let form = reqwest::Url::parse(&format!(
        "https://test.invalid/?{}",
        request.split("\r\n\r\n").nth(1).unwrap()
    ))
    .unwrap();
    let fields: HashMap<_, _> = form.query_pairs().into_owned().collect();
    assert_eq!(fields["grant_type"], "authorization_code");
    assert_eq!(fields["code"], "code");
    assert_eq!(
        URL_SAFE_NO_PAD.encode(Sha256::digest(fields["code_verifier"].as_bytes())),
        challenge
    );
    assert!(!fields.contains_key("client_secret"));
    let rebound = TcpListener::bind("127.0.0.1:43827").await.unwrap();
    drop(rebound);
}

#[tokio::test]
async fn cancel_timeout_and_logout_invalidate_pending_start() {
    let dir = tempfile::tempdir().unwrap();
    let sessions = Sessions::with_store(Arc::new(MemoryStore::default()), Some(dir.path().into()));
    for action in ["cancel", "logout", "timeout"] {
        let s = sessions.clone();
        let (started, ready) = tokio::sync::oneshot::channel();
        let handle = tokio::spawn(async move {
            s.sign_in_with(ORIGIN, Duration::from_millis(100), async {
                started.send(()).unwrap();
                std::future::pending().await
            })
            .await
        });
        ready.await.unwrap();
        if action == "cancel" {
            sessions.cancel();
        }
        if action == "logout" {
            assert!(sessions
                .sign_out(ORIGIN, &crate::http::client().unwrap())
                .await
                .unwrap());
        }
        let result = handle.await.unwrap().unwrap_err();
        assert!(result.contains(if action == "timeout" {
            "timed out"
        } else {
            "cancelled"
        }));
        assert!(sessions
            .owner(ORIGIN)
            .await
            .unwrap()
            .read()
            .await
            .unwrap()
            .is_none());
    }
}

#[tokio::test]
async fn signout_revokes_the_stored_refresh_and_clears_even_on_remote_failure() {
    for status in [200, 503] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (sessions, store, _dir) =
            prepared(&format!("http://{}/revoke", listener.local_addr().unwrap())).await;
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = vec![0; 8192];
            let n = socket.read(&mut bytes).await.unwrap();
            socket.write_all(format!("HTTP/1.1 {status} result\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
            String::from_utf8(bytes[..n].to_vec()).unwrap()
        });
        let client = crate::http::client().unwrap();
        assert_eq!(
            sessions.sign_out(ORIGIN, &client).await.unwrap(),
            status == 200
        );
        let request = server.await.unwrap();
        assert!(request.starts_with("POST /revoke"));
        assert!(request.contains("token_type_hint=refresh_token"));
        assert!(request.contains("token=old-refresh"));
        assert!(!request.contains("grant_type"));
        assert!(store.read(ORIGIN).unwrap().is_none());
        assert!(sessions
            .token_for(&format!("{ORIGIN}/v1/jobs").parse().unwrap(), &client)
            .await
            .unwrap()
            .is_none());
    }
}
