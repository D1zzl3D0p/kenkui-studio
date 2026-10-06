//! Opt-in integration with the sibling server's Python environment, without synthesis.
use kenkui_studio_lib::sidecar::{Action, Config, Supervisor};
use std::{path::PathBuf, time::Duration};

#[test]
#[ignore = "requires KENKUI_SIDECAR_TEST_PYTHON with kenkui-server installed"]
fn real_server_starts_serves_stops_and_restarts() {
    let executable = PathBuf::from(
        std::env::var_os("KENKUI_SIDECAR_TEST_PYTHON")
            .expect("Set KENKUI_SIDECAR_TEST_PYTHON to the server virtualenv's Python"),
    );
    assert!(executable.is_absolute(), "Use an absolute virtualenv Python path");
    let data = tempfile::tempdir().unwrap();
    let supervisor = Supervisor::new(Some(Config {
        executable,
        script: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sidecar/kenkui_sidecar.py"),
        data_dir: data.path().join("local-server"),
        provision_voices: false,
        startup_timeout: Duration::from_secs(60),
        shutdown_timeout: Duration::from_secs(15),
    }));
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let mut previous_pid = None;
    for _ in 0..2 {
        let running = supervisor.request(Action::Start).unwrap();
        assert_eq!(running.state, "running");
        assert_ne!(running.pid, previous_pid);
        previous_pid = running.pid;
        let origin = running.base_url.unwrap();
        let response = runtime.block_on(async {
            client.get(format!("{origin}/v1/health")).send().await?.error_for_status()?;
            client.get(format!("{origin}/v1/capabilities")).send().await?
                .error_for_status()?.json::<serde_json::Value>().await
        });
        // Always stop and reap before asserting the HTTP result or removing data.
        let stopped = supervisor.request(Action::Stop).unwrap();
        assert_eq!(stopped.state, "stopped");
        assert!(stopped.pid.is_none());
        assert!(stopped.base_url.is_none());
        let capabilities = response.unwrap();
        assert_eq!(capabilities["apiVersion"], "1");
        assert_eq!(capabilities["auth"]["mode"], "none");
        assert!(runtime.block_on(client.get(format!("{origin}/v1/health")).send()).is_err());
    }
}
