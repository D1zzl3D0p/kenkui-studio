# Kenkui mobile export bridge

Private Tauri plugin for Android and iOS. Rust downloads an M4B into an isolated
`kenkui-exports` cache directory, then invokes this bridge on a worker thread.
There are no enabled JavaScript plugin commands and no broad storage permissions.

Android grants read access to the specific file through a dedicated FileProvider
and opens ACTION_SEND. Its return means the chooser opened; it does not prove the
recipient saved the file. iOS uses UIActivityViewController and resolves when the
sheet finishes or is dismissed. Both validate the cached file path before sharing.

See [mobile development](../../../docs/setup/mobile-development.md) for setup,
cache retention, current limitations and device acceptance checks. The Kotlin and
Swift code has not yet been compiled in the implementation environment.
