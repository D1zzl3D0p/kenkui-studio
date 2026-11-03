use crate::oauth::Config;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Serialize, Deserialize)]
pub(super) struct Record {
    pub api_origin: String,
    pub config: Config,
    pub subject: String,
    pub refresh: String,
    pub uncertain: bool,
}

pub(super) trait SecretStore: Send + Sync {
    fn read(&self, origin: &str) -> Result<Option<String>, String>;
    fn write(&self, origin: &str, secret: &str) -> Result<(), String>;
    fn remove(&self, origin: &str) -> Result<(), String>;
}

pub(super) struct CredentialStore;
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
fn entry(origin: &str) -> Result<keyring::Entry, String> {
    let account = URL_SAFE_NO_PAD.encode(Sha256::digest(origin.as_bytes()));
    keyring::Entry::new("org.kenkui.studio.neon.v2", &account)
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

/// The file contains no credentials. A stable per-user location is shared by all app builds.
pub(super) struct Owner {
    pub origin: String,
    store: Arc<dyn SecretStore>,
    _lock: File,
}
pub(super) fn lock_dir() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .map(|dir| dir.join("org.kenkui.studio").join("auth-locks"))
        .ok_or_else(|| "No per-user credential lock directory".into())
}
impl Owner {
    pub fn acquire(dir: &Path, origin: &str, store: Arc<dyn SecretStore>) -> Result<Self, String> {
        std::fs::create_dir_all(dir).map_err(|_| "Cannot create credential lock directory")?;
        let name = URL_SAFE_NO_PAD.encode(Sha256::digest(origin.as_bytes()));
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(dir.join(name))
            .map_err(|_| "Cannot open credential lock")?;
        FileExt::lock_exclusive(&lock).map_err(|_| "Cannot acquire credential lock")?;
        Ok(Self {
            origin: origin.into(),
            store,
            _lock: lock,
        })
    }
    pub async fn read(self: &Arc<Self>) -> Result<Option<Record>, String> {
        let owner = self.clone();
        tokio::task::spawn_blocking(move || {
            owner
                .store
                .read(&owner.origin)?
                .map(|raw| {
                    let record: Record =
                        serde_json::from_str(&raw).map_err(|_| "Cannot read saved sign-in")?;
                    if record.api_origin != owner.origin {
                        return Err("Saved sign-in origin mismatch".into());
                    }
                    record.config.validate()?;
                    Ok(record)
                })
                .transpose()
        })
        .await
        .map_err(|_| "Credential task failed")?
    }
    pub async fn write(self: &Arc<Self>, record: &Record) -> Result<(), String> {
        let raw = serde_json::to_string(record).map_err(|_| "Cannot serialize sign-in")?;
        let owner = self.clone();
        tokio::task::spawn_blocking(move || owner.store.write(&owner.origin, &raw))
            .await
            .map_err(|_| "Credential task failed")?
    }
    pub async fn clear(self: &Arc<Self>) -> Result<(), String> {
        let owner = self.clone();
        tokio::task::spawn_blocking(move || owner.store.remove(&owner.origin))
            .await
            .map_err(|_| "Credential task failed")?
    }
}
