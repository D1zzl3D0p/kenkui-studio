import { existsSync, readdirSync, openSync, readSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const target = process.argv[2] || (process.platform === "darwin" ? "ios" : "android");
if (!["android", "ios"].includes(target)) {
  console.error("Usage: npm run mobile:doctor -- android|ios");
  process.exit(2);
}
let failed = false;
function check(label, ok, fix) {
  console.log(`${ok ? "OK" : "NOT READY"} ${label}${ok ? "" : ` — ${fix}`}`);
  if (!ok) failed = true;
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 60000 });
  if (result.error?.code === "ETIMEDOUT") console.error(`Timed out checking ${command}; retry when the host is less busy.`);
  return result;
}
// Avoid a shell interpreting an incompatible ELF binary after exec reports ENOEXEC.
function executableWorks(path, args) {
  if (process.platform === "linux") {
    let file;
    try {
      file = openSync(path, "r");
      const header = Buffer.alloc(20);
      if (readSync(file, header, 0, header.length, 0) === header.length && header.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]))) {
        const expected = { x64: 62, arm64: 183, ia32: 3, arm: 40 }[process.arch];
        const machine = header[5] === 2 ? header.readUInt16BE(18) : header.readUInt16LE(18);
        if (expected && machine !== expected) return false;
      }
    } catch { return false; }
    finally { if (file !== undefined) closeSync(file); }
  }
  return run(path, args).status === 0;
}
console.log(`Kenkui Studio ${target} development prerequisites (${process.platform}/${process.arch})`);
check("Rust", run("rustc", ["--version"]).status === 0, "Install stable Rust with rustup and put it on PATH.");
const installed = run("rustup", ["target", "list", "--installed"]).stdout || "";
if (target === "android") {
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : "java";
  const version = run(java, ["-version"]);
  const major = Number((`${version.stderr}${version.stdout}`.match(/version "(\d+)/) || [])[1]);
  check("JDK 17+", version.status === 0 && major >= 17, "Install Android Studio's JDK and set JAVA_HOME.");
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), "Android", "Sdk"), join(homedir(), "Library", "Android", "sdk"), process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk")];
  const sdk = candidates.find((path) => path && existsSync(path));
  check("Android SDK", !!sdk, "Run mise install, or install Android Studio and set ANDROID_HOME.");
  const manager = process.platform === "win32" ? run("cmd.exe", ["/d", "/s", "/c", "sdkmanager --version"]) : run("sdkmanager", ["--version"]);
  check("Android SDK manager executable", manager.status === 0,
    "Run through mise; this project pins Java-based command-line tools for Linux ARM64 compatibility.");
  const adb = sdk && join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
  check("Android platform tools executable", !!adb && executableWorks(adb, ["version"]),
    "Install Platform-Tools for a supported host; Google's Linux binaries require x86-64.");
  check("Android SDK platform 36", !!sdk && existsSync(join(sdk, "platforms", "android-36")), "Install Android SDK Platform 36 in SDK Manager.");
  const ndks = sdk && existsSync(join(sdk, "ndk")) ? readdirSync(join(sdk, "ndk")) : [];
  const ndkVersion = ndks.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
  const ndk = process.env.NDK_HOME || (sdk && ndkVersion ? join(sdk, "ndk", ndkVersion) : undefined);
  check("Android NDK", !!ndk && existsSync(ndk), "Install NDK (Side by side) in SDK Manager; set NDK_HOME to that version.");
  if (ndk && existsSync(ndk)) {
    const hostTag = process.platform === "darwin" ? "darwin-x86_64" : process.platform === "win32" ? "windows-x86_64" : "linux-x86_64";
    const clang = join(ndk, "toolchains", "llvm", "prebuilt", hostTag, "bin", process.platform === "win32" ? "clang.exe" : "clang");
    check("NDK compiler executable", executableWorks(clang, ["--version"]),
      "The installed NDK must run on this host. Google supplies Linux x86-64 builds, not Linux ARM64 builds.");
  }
  const buildTools = sdk && join(sdk, "build-tools", "36.0.0");
  check("Android Build-Tools 36.0.0", !!buildTools && existsSync(buildTools), "sdkmanager 'build-tools;36.0.0'");
  if (buildTools && existsSync(buildTools)) {
    const aapt = join(buildTools, process.platform === "win32" ? "aapt2.exe" : "aapt2");
    check("Android resource compiler executable", executableWorks(aapt, ["version"]),
      "Use Build-Tools for a supported build host; Google's Linux binaries require x86-64.");
  }
  check("Android ARM64 Rust target", installed.includes("aarch64-linux-android"), "rustup target add aarch64-linux-android (add x86_64-linux-android for an x86 emulator).");
} else {
  check("macOS host", process.platform === "darwin", "iOS builds require a Mac.");
  check("Xcode", run("xcodebuild", ["-version"]).status === 0, "Install Xcode, open it once, and select its developer directory.");
  check("iOS SDK", run("xcrun", ["--sdk", "iphoneos", "--show-sdk-path"]).status === 0, "Install the iOS platform in Xcode.");
  check("CocoaPods", run("pod", ["--version"]).status === 0, "Install CocoaPods before tauri ios init.");
  check("iOS Rust targets", installed.includes("aarch64-apple-ios"), "rustup target add aarch64-apple-ios aarch64-apple-ios-sim (Apple Silicon simulator).");
}
console.log("Guide: docs/setup/mobile-development.md");
process.exitCode = failed ? 1 : 0;
