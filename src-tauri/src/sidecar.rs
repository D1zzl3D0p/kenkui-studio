//! One actor owns the local API child. IPC cancellation never drops ownership.
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::mpsc::{self, Receiver, Sender},
    thread,
    time::{Duration, Instant},
};

#[derive(Clone)]
pub struct Config {
    pub executable: PathBuf,
    pub script: PathBuf,
    pub data_dir: PathBuf,
    pub provision_voices: bool,
    pub startup_timeout: Duration,
    pub shutdown_timeout: Duration,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: &'static str,
    pub base_url: Option<String>,
    pub pid: Option<u32>,
    pub error: Option<String>,
    pub progress: Option<String>,
}
impl Status {
    fn new(state: &'static str) -> Self {
        Self {
            state,
            base_url: None,
            pid: None,
            error: None,
            progress: None,
        }
    }
}

#[derive(Clone, Copy)]
pub enum Action {
    Start,
    Stop,
    Status,
    Quit,
}
type Reply = Sender<Result<Status, String>>;

pub struct Supervisor {
    commands: Sender<(Action, Reply)>,
}
impl Supervisor {
    pub fn new(config: Option<Config>) -> Self {
        let (commands, inbox) = mpsc::channel();
        thread::spawn(move || Actor::new(config).run(inbox));
        Self { commands }
    }

    pub fn request(&self, action: Action) -> Result<Status, String> {
        let (reply, result) = mpsc::channel();
        self.commands
            .send((action, reply))
            .map_err(|_| "Local server supervisor stopped")?;
        result
            .recv()
            .map_err(|_| "Local server supervisor stopped")?
    }
}
impl Drop for Supervisor {
    fn drop(&mut self) {
        let (reply, _) = mpsc::channel();
        let _ = self.commands.send((Action::Quit, reply));
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ready {
    r#type: String,
    protocol_version: u32,
    base_url: String,
    pid: u32,
}

enum StartupEvent {
    Progress(String),
    Ready(String),
}

fn startup_event(line: &[u8], pid: u32) -> Result<StartupEvent, String> {
    let value: serde_json::Value =
        serde_json::from_slice(line).map_err(|_| "Invalid local server startup message")?;
    if value["type"] == "progress" {
        let message = value["message"]
            .as_str()
            .filter(|message| !message.is_empty() && message.len() <= 512)
            .ok_or("Invalid local server progress message")?;
        if value["protocolVersion"] != 1 || value["pid"] != pid {
            return Err("Invalid local server progress message".into());
        }
        Ok(StartupEvent::Progress(message.to_string()))
    } else {
        readiness(line, pid).map(StartupEvent::Ready)
    }
}

fn readiness(line: &[u8], pid: u32) -> Result<String, String> {
    let ready: Ready =
        serde_json::from_slice(line).map_err(|_| "Invalid local server readiness message")?;
    let url = reqwest::Url::parse(&ready.base_url).map_err(|_| "Invalid local server address")?;
    if ready.r#type != "ready"
        || ready.protocol_version != 1
        || ready.pid != pid
        || url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.port() == Some(0)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Invalid local server readiness message".into());
    }
    Ok(url.origin().ascii_serialization())
}

struct Actor {
    config: Option<Config>,
    status: Status,
    child: Option<Child>,
    ready: Option<Receiver<Result<StartupEvent, String>>>,
    deadline: Option<Instant>,
    starts: Vec<Reply>,
    stops: Vec<Reply>,
    quitting: bool,
}
impl Actor {
    fn new(config: Option<Config>) -> Self {
        Self {
            status: Status::new(if config.is_some() {
                "stopped"
            } else {
                "disabled"
            }),
            config,
            child: None,
            ready: None,
            deadline: None,
            starts: vec![],
            stops: vec![],
            quitting: false,
        }
    }

    fn run(mut self, inbox: Receiver<(Action, Reply)>) {
        loop {
            self.poll();
            if self.quitting && self.child.is_none() {
                break;
            }
            let command = if self.child.is_some() {
                inbox.recv_timeout(Duration::from_millis(25))
            } else {
                inbox
                    .recv()
                    .map_err(|_| mpsc::RecvTimeoutError::Disconnected)
            };
            match command {
                Ok((action, reply)) => self.command(action, reply),
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    self.quitting = true;
                    self.stop();
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        }
    }

    fn command(&mut self, action: Action, reply: Reply) {
        match action {
            Action::Status => {
                let _ = reply.send(Ok(self.status.clone()));
            }
            Action::Start => {
                if self.quitting || self.status.state == "stopping" {
                    let _ = reply.send(Err("Local server is stopping".into()));
                } else if self.status.state == "running" {
                    let _ = reply.send(Ok(self.status.clone()));
                } else if self.status.state == "starting" {
                    self.starts.push(reply);
                } else if self.child.is_some() {
                    let _ = reply.send(Err(
                        "The previous local server process has not exited".into()
                    ));
                } else if self.config.is_none() {
                    let _ = reply.send(Err("Local server is not configured".into()));
                } else {
                    self.starts.push(reply);
                    if let Err(error) = self.start() {
                        self.fail(error);
                    }
                }
            }
            Action::Stop | Action::Quit => {
                if matches!(action, Action::Quit) {
                    self.quitting = true;
                }
                self.stops.push(reply);
                self.stop();
            }
        }
    }

    fn start(&mut self) -> Result<(), String> {
        let config = self.config.as_ref().unwrap();
        std::fs::create_dir_all(&config.data_dir)
            .map_err(|e| format!("Cannot create local server data directory: {e}"))?;
        let mut command = Command::new(&config.executable);
        command.arg(&config.script);
        if config.provision_voices {
            command.arg("--provision-voices");
        }
        command
            .arg("--data-dir")
            .arg(&config.data_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Cannot start local server: {e}"))?;
        let pid = child.id();
        let stdout = child.stdout.take().unwrap();
        let (send, receive) = mpsc::sync_channel(8);
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = Vec::new();
                let result = reader
                    .by_ref()
                    .take(4097)
                    .read_until(b'\n', &mut line)
                    .map_err(|e| format!("Cannot read local server readiness: {e}"))
                    .and_then(|_| {
                        if line.len() > 4096 || !line.ends_with(b"\n") {
                            Err("Local server closed or exceeded its readiness channel".into())
                        } else {
                            startup_event(&line, pid)
                        }
                    });
                let finished = !matches!(result, Ok(StartupEvent::Progress(_)));
                if send.send(result).is_err() || finished {
                    break;
                }
            }
            // Drain any later output without retaining an unbounded buffer.
            let _ = std::io::copy(&mut reader, &mut std::io::sink());
        });
        self.status = Status {
            pid: Some(pid),
            ..Status::new("starting")
        };
        self.child = Some(child);
        self.ready = Some(receive);
        self.deadline = Some(Instant::now() + config.startup_timeout);
        Ok(())
    }

    fn stop(&mut self) {
        for reply in self.starts.drain(..) {
            let _ = reply.send(Err("Local server startup cancelled".into()));
        }
        if let Some(child) = self.child.as_mut() {
            if self.status.state != "stopping" {
                drop(child.stdin.take());
                self.status.state = "stopping";
                self.status.base_url = None;
                self.deadline =
                    Some(Instant::now() + self.config.as_ref().unwrap().shutdown_timeout);
            }
        } else {
            self.status = Status::new(if self.config.is_some() {
                "stopped"
            } else {
                "disabled"
            });
            self.reply_stops();
        }
    }

    fn reply_stops(&mut self) {
        for reply in self.stops.drain(..) {
            let result = if self.child.is_some() {
                Err(self
                    .status
                    .error
                    .clone()
                    .unwrap_or_else(|| "Local server did not exit".into()))
            } else {
                Ok(self.status.clone())
            };
            let _ = reply.send(result);
        }
    }

    fn kill_and_reap(&mut self) -> Result<(), String> {
        if let Some(child) = self.child.as_mut() {
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                child
                    .kill()
                    .map_err(|e| format!("Cannot stop local server: {e}"))?;
                child
                    .wait()
                    .map_err(|e| format!("Cannot reap local server: {e}"))?;
            }
        }
        self.child = None;
        Ok(())
    }

    fn fail(&mut self, mut error: String) {
        // Reap before allowing another start to touch the same database.
        if let Err(cleanup) = self.kill_and_reap() {
            error = format!("{error}; {cleanup}");
        }
        self.ready = None;
        self.deadline = None;
        self.status = Status {
            error: Some(error.clone()),
            pid: self.child.as_ref().map(Child::id),
            ..Status::new("failed")
        };
        for reply in self.starts.drain(..) {
            let _ = reply.send(Err(error.clone()));
        }
        self.reply_stops();
    }

    fn poll(&mut self) {
        let Some(child) = self.child.as_mut() else {
            return;
        };
        match child.try_wait() {
            Ok(Some(exit)) => {
                self.child = None;
                self.ready = None;
                self.deadline = None;
                if self.status.state == "stopping" {
                    self.status = Status::new("stopped");
                    self.reply_stops();
                } else {
                    self.fail(format!("Local server exited unexpectedly ({exit})"));
                }
                return;
            }
            Err(error) => {
                self.fail(format!("Cannot inspect local server: {error}"));
                return;
            }
            Ok(None) => {}
        }
        if self.status.state == "starting" {
            match self.ready.as_ref().unwrap().try_recv() {
                Ok(Ok(StartupEvent::Progress(message))) => {
                    self.status.progress = Some(message);
                }
                Ok(Ok(StartupEvent::Ready(url))) => {
                    self.status.state = "running";
                    self.status.base_url = Some(url);
                    self.status.progress = None;
                    self.deadline = None;
                    for reply in self.starts.drain(..) {
                        let _ = reply.send(Ok(self.status.clone()));
                    }
                }
                Ok(Err(error)) => {
                    self.fail(error);
                    return;
                }
                Err(mpsc::TryRecvError::Disconnected) => {
                    self.fail("Local server readiness channel closed".into());
                    return;
                }
                Err(mpsc::TryRecvError::Empty) => {}
            }
        }
        if self
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            if self.status.state == "stopping" {
                if let Err(error) = self.kill_and_reap() {
                    self.fail(error);
                    return;
                }
                self.ready = None;
                self.deadline = None;
                self.status = Status::new("stopped");
                self.reply_stops();
            } else {
                self.fail("Local server startup timed out".into());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn fixture(mode: &str) -> (tempfile::TempDir, Arc<Supervisor>) {
        let dir = tempfile::tempdir().unwrap();
        let supervisor = Supervisor::new(Some(Config {
            executable: std::env::var_os("KENKUI_SIDECAR_TEST_PYTHON")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "python" } else { "python3" })),
            script: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../tests/sidecar/supervisor_fixture.py"),
            data_dir: dir.path().join(mode),
            provision_voices: false,
            startup_timeout: Duration::from_secs(2),
            shutdown_timeout: Duration::from_millis(150),
        }));
        (dir, Arc::new(supervisor))
    }
    fn wait_state(supervisor: &Supervisor, expected: &str) -> Status {
        let end = Instant::now() + Duration::from_secs(5);
        loop {
            let status = supervisor.request(Action::Status).unwrap();
            if status.state == expected {
                return status;
            }
            assert!(Instant::now() < end, "Expected {expected}, got {status:?}");
            thread::sleep(Duration::from_millis(10));
        }
    }
    #[test]
    fn disabled_does_not_spawn() {
        let supervisor = Supervisor::new(None);
        assert_eq!(
            supervisor.request(Action::Status).unwrap().state,
            "disabled"
        );
        assert!(supervisor.request(Action::Start).is_err());
        assert_eq!(supervisor.request(Action::Stop).unwrap().state, "disabled");
    }
    #[test]
    fn spawn_failure_leaves_no_process_or_endpoint() {
        let dir = tempfile::tempdir().unwrap();
        let supervisor = Supervisor::new(Some(Config {
            executable: dir.path().join("missing-python"),
            script: PathBuf::from("unused.py"),
            data_dir: dir.path().join("server"),
            provision_voices: false,
            startup_timeout: Duration::from_secs(2),
            shutdown_timeout: Duration::from_millis(150),
        }));
        assert!(supervisor
            .request(Action::Start)
            .unwrap_err()
            .contains("Cannot start"));
        let status = supervisor.request(Action::Status).unwrap();
        assert_eq!(status.state, "failed");
        assert!(status.pid.is_none());
        assert!(status.base_url.is_none());
        assert_eq!(supervisor.request(Action::Stop).unwrap().state, "stopped");
    }

    #[test]
    fn dropping_supervisor_closes_the_control_pipe() {
        let (dir, supervisor) = fixture("ready");
        supervisor.request(Action::Start).unwrap();
        drop(supervisor);
        let deadline = Instant::now() + Duration::from_secs(5);
        while !dir.path().join("ready/stopped").exists() {
            assert!(Instant::now() < deadline, "Child did not receive EOF");
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn concurrent_starts_share_one_child_and_stop_allows_restart() {
        let (_dir, supervisor) = fixture("ready");
        let other = supervisor.clone();
        let start = thread::spawn(move || other.request(Action::Start).unwrap());
        let first = supervisor.request(Action::Start).unwrap();
        assert_eq!(first.state, "running");
        assert_eq!(first.pid, start.join().unwrap().pid);
        assert_eq!(supervisor.request(Action::Stop).unwrap().state, "stopped");
        let next = supervisor.request(Action::Start).unwrap();
        assert_ne!(first.pid, next.pid);
        assert_eq!(supervisor.request(Action::Stop).unwrap().state, "stopped");
    }
    #[test]
    fn progress_can_precede_readiness() {
        let (_dir, supervisor) = fixture("progress");
        let running = supervisor.request(Action::Start).unwrap();
        assert_eq!(running.state, "running");
        assert!(running.progress.is_none());
        supervisor.request(Action::Stop).unwrap();
    }
    #[test]
    fn startup_can_be_cancelled_without_waiting_for_its_deadline() {
        let (_dir, supervisor) = fixture("timeout");
        let other = supervisor.clone();
        let start = thread::spawn(move || other.request(Action::Start));
        wait_state(&supervisor, "starting");
        let before = Instant::now();
        assert_eq!(supervisor.request(Action::Stop).unwrap().state, "stopped");
        assert!(before.elapsed() < Duration::from_secs(1));
        assert!(start.join().unwrap().unwrap_err().contains("cancelled"));
    }
    #[test]
    fn startup_failure_and_oversized_protocol_are_bounded() {
        for mode in ["invalid", "oversized", "timeout"] {
            let (_dir, supervisor) = fixture(mode);
            assert!(supervisor.request(Action::Start).is_err());
            let status = supervisor.request(Action::Status).unwrap();
            assert_eq!(status.state, "failed");
            assert!(status.pid.is_none());
            assert!(status.base_url.is_none());
        }
    }
    #[test]
    fn crash_clears_endpoint_and_can_be_restarted() {
        let (dir, supervisor) = fixture("ready");
        supervisor.request(Action::Start).unwrap();
        std::fs::write(dir.path().join("ready/crash"), "").unwrap();
        let status = wait_state(&supervisor, "failed");
        assert!(status.base_url.is_none());
        assert!(status.error.unwrap().contains("exited unexpectedly"));
        std::fs::remove_file(dir.path().join("ready/crash")).unwrap();
        supervisor.request(Action::Start).unwrap();
        supervisor.request(Action::Stop).unwrap();
    }
    #[test]
    fn uncooperative_child_is_killed_and_reaped_on_quit() {
        let (_dir, supervisor) = fixture("stubborn");
        supervisor.request(Action::Start).unwrap();
        let before = Instant::now();
        assert_eq!(supervisor.request(Action::Quit).unwrap().state, "stopped");
        assert!(before.elapsed() < Duration::from_secs(2));
        assert!(supervisor.request(Action::Start).is_err());
    }
    #[test]
    fn readiness_rejects_untrusted_endpoints_and_wrong_identity() {
        for url in [
            "https://127.0.0.1:1234",
            "http://localhost:1234",
            "http://example.com:1234",
            "http://127.0.0.1:0",
            "http://127.0.0.1:1234/path",
            "http://user@127.0.0.1:1234",
            "http://127.0.0.1:1234?query",
            "http://127.0.0.1:1234#fragment",
        ] {
            let line =
                serde_json::json!({"type":"ready", "protocolVersion":1, "baseUrl":url,"pid":42});
            assert!(readiness(line.to_string().as_bytes(), 42).is_err(), "{url}");
        }
        let valid =
            br#"{"type":"ready","protocolVersion":1,"baseUrl":"http://127.0.0.1:1234","pid":42}"#;
        assert!(readiness(valid, 41).is_err());
        assert_eq!(readiness(valid, 42).unwrap(), "http://127.0.0.1:1234");
    }

    #[test]
    fn progress_requires_protocol_identity_and_bounded_message() {
        let valid = br#"{"type":"progress","protocolVersion":1,"pid":42,"message":"Preparing voice 1 of 2"}"#;
        assert!(matches!(
            startup_event(valid, 42),
            Ok(StartupEvent::Progress(_))
        ));
        assert!(startup_event(valid, 41).is_err());
        for (version, message) in [
            (2, "hello".to_string()),
            (1, "".to_string()),
            (1, "x".repeat(513)),
        ] {
            let line = serde_json::json!({"type":"progress","protocolVersion":version,"pid":42,"message":message});
            assert!(startup_event(line.to_string().as_bytes(), 42).is_err());
        }
    }
}
