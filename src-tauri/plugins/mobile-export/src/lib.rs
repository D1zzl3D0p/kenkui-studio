//! Rust-only bridge. JavaScript cannot pass arbitrary local paths to the share sheet.
#[cfg(mobile)]
use tauri::{plugin::PluginHandle, Manager};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_mobile_export);

#[cfg(mobile)]
pub struct MobileExport<R: Runtime>(PluginHandle<R>);

#[cfg(mobile)]
impl<R: Runtime> MobileExport<R> {
    /// Must be called from a worker, as the iOS sheet resolves on dismissal.
    pub fn share(&self, path: &std::path::Path) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("share", serde_json::json!({ "path": path }))
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mobile-export")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            let handle =
                _api.register_android_plugin("org.kenkui.mobileexport", "MobileExportPlugin")?;
            #[cfg(target_os = "ios")]
            let handle = _api.register_ios_plugin(init_plugin_mobile_export)?;
            #[cfg(mobile)]
            _app.manage(MobileExport(handle));
            Ok(())
        })
        .build()
}
