# Mobile development

Studio's first mobile milestone is a foreground client for a separately running
Kenkui server. Streaming playback is **not a release requirement**: users can
export an M4B and listen in another app. The existing in-app player still loads
the whole file and is optional.

## Implemented, awaiting native builds

- Android and iOS export bridge under `src-tauri/plugins/mobile-export`.
  “Save or share M4B” downloads into a private cache through the Rust HTTP client,
  then presents the system share sheet. JavaScript receives progress, not bytes
  or a local cache path. Android uses a FileProvider restricted to that cache and
  temporary read access; iOS passes a file URL to UIActivityViewController, with
  an iPad popover anchor.
- Download cancellation and partial-file cleanup. After sheet handoff, dismiss
  using native controls. Android reports that the chooser opened, not that the
  receiving app saved the book. Shared files remain cached for recipients;
  export directories older than 24 hours are removed on the next export.
  Cache is temporary, may be reclaimed by the OS, and is not an offline library.
- Native window resume notifications refresh job state and replace stale event
  streams, including after retry exhaustion. A closed view stays closed.
- Safe-area padding, viewport coverage, readable touch form fields and an iOS
  local-network usage description. Server selection already rejects loopback on
  mobile and saves settings before reload.

## Android

The repository pins Node 24, Java 21, Rust (with Android targets), and Android command-line
tools 19.0 in `mise.toml`. Version 19 retains the Java SDK manager; version 23
ships an x86-64 native Android CLI on Linux that cannot run on this ARM64 host. Install them without changing global mise defaults:

```sh
mise trust
mise install
mise run android:setup
mise run android:doctor
mise exec -- npm run android:init
mise exec -- npm run android:dev
mise exec -- npm run android:build
```

`android:setup` shows SDK licenses, then installs platform 36, Build-Tools 36.0.0,
Platform-Tools and NDK 30.0.16248370. Mise supplies `JAVA_HOME`, `ANDROID_HOME`,
`ANDROID_SDK_ROOT` and `NDK_HOME`. Android Studio remains optional for command-line
builds; see [Tauri's Android prerequisites](https://v2.tauri.app/start/prerequisites/#android)
for emulator and IDE setup.

**Host architecture matters:** Google's [Linux NDK distribution](https://developer.android.com/ndk/downloads)
is x86-64. On Linux ARM64, Java, Rust and `sdkmanager` work, but installing SDK/NDK
packages does not make their x86-64 host binaries runnable. The doctor checks the architecture of
`adb`, the NDK compiler and the Android resource compiler, then executes compatible
binaries to catch this. Use a supported x86-64 Linux machine or
a Mac for native builds; this configuration does not set up emulation or unofficial
replacement toolchains.

Verified on 2026-09-17: the mise tools and all SDK packages above are installed,
and `android:init` generated `src-tauri/gen/android`. The doctor passes Rust, Java,
SDK manager and package checks, but flags the incompatible `adb`, Clang and
`aapt2` binaries on this Linux ARM64 host. No APK has been built and the native
export bridge still needs compilation and device testing on a supported host.

## iOS

Use a Mac with Xcode and [Tauri's iOS prerequisites](https://v2.tauri.app/start/prerequisites/#ios).
Install the iOS platform and a simulator runtime in Xcode. After completing the
[Mac toolchain setup](native-development.md#build-on-macos), install CocoaPods and
the device/simulator Rust targets:

```sh
brew install cocoapods
mise exec -- rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
mise exec -- npm run mobile:doctor -- ios
mise exec -- npm run ios:init
mise exec -- npm run ios:dev
```

Run `ios:init` once to generate the Xcode project. For a device release build:

```sh
mise exec -- npm run ios:build
```

Configure your signing team in the generated project for a physical device.
Rust targets include `aarch64-apple-ios` and `aarch64-apple-ios-sim` for Apple
Silicon simulators. Project generation, Swift compilation and device execution
have not been performed in this Linux environment.

Generated project source can now be committed under `src-tauri/gen/android` and
`src-tauri/gen/apple`; schemas, build output, local SDK settings and signing keys
are ignored. Inspect generated changes before committing them.

## First device acceptance run

Start with an **unauthenticated self-hosted server** on the same network. Use its
LAN address, not `localhost`, and bind the server to a reachable interface.
Cloud login still uses a desktop loopback callback and desktop credential stores;
mobile Cloud authentication needs its own callback and secure storage work.
Native auth credentials must stay out of JavaScript. Mobile Cloud sign-in is
not claimed to work yet.

1. Add the LAN server; on iOS allow local-network access. Restart and verify the
   server selection persists.
2. Import an EPUB, create a job, background the app, then return after several
   minutes. Confirm the snapshot and live updates recover.
3. Export a large M4B, cancel once, then complete it. Open it in a player or save
   it using a receiving app; on iOS also test Save to Files and iPad presentation.
4. Cancel the native sheet, deny local-network access, disconnect Wi-Fi and test
   low storage. Check readable errors and removal of partial files.
5. Verify portrait/landscape layouts, keyboard behavior and Android back navigation.

Background downloads, process-death continuation, an offline library, mobile
Cloud sign-in and signed store releases remain pending. Keep the app foregrounded
while exporting; there is no background transfer service yet.

## Automated checks and sources

`npm test -- --maxWorkers=2`, `npm run test:native`, `npm run build:web` and
`npm run build:native` cover the shared frontend and Rust core. They do not compile
the Kotlin/Swift bridge or prove native file sharing and lifecycle delivery.

The bridge follows [Tauri's mobile plugin API](https://v2.tauri.app/develop/plugins/develop-mobile/),
[Android secure file sharing](https://developer.android.com/training/secure-file-sharing)
and [Apple's activity controller](https://developer.apple.com/documentation/uikit/uiactivityviewcontroller).
