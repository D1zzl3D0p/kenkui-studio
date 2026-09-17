import { invoke as tauriInvoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { load } from "@tauri-apps/plugin-store";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl as openExternalUrl } from "@tauri-apps/plugin-opener";
import type { Host, HostCapabilities, SaveArtifactOptions } from "./index";
import { createServerRegistry } from "./native-registry";
import { createNativeAuth } from "./native-auth";
import { channelEventSourceFactory, type EventChannel, type EventFrame } from "./channel-event-source";

type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;
const mobilePlatforms: Record<string, true> = { ios: true, android: true };

export function hostCapabilitiesFor(platform: string): HostCapabilities {
  const mobile = Boolean(mobilePlatforms[platform]);
  return {
    chooseServer: true,
    reachLoopback: !mobile,
    manageLocalServer: false,
    saveToPath: !mobile,
  };
}

/** A fetch backed by Rust. Credentials are scoped to `baseUrl`'s origin. */
export function nativeFetch(invoke: Invoke, baseUrl: string, timeoutMs = 120_000): typeof globalThis.fetch {
  const trusted = baseUrl ? new URL(baseUrl).origin : "";
  return async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    const headers = [...new Headers(init?.headers).entries()];
    if (!trusted || new URL(url).origin !== trusted) {
      throw new TypeError("The request does not belong to the selected server.");
    }
    const body = init?.body === undefined || init.body === null
      ? undefined
      : Array.from(new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer()));

    let response: { status: number; headers: [string, string][]; body: number[] };
    try {
      response = await invoke("kenkui_request", {
        spec: { url, method: (init?.method ?? "GET").toUpperCase(), headers, body, timeoutMs },
      }) as typeof response;
    } catch (cause) {
      // Preserve fetch's network-error contract, including idempotent job retry.
      throw new TypeError("The server request failed.", { cause });
    }

    return new Response([204, 205, 304].includes(response.status) ? null : new Uint8Array(response.body), {
      status: response.status,
      headers: new Headers(response.headers),
    });
  };
}

export function openEventChannel(invoke: Invoke): (url: string) => EventChannel {
  return (url) => {
    let onFrame: (frame: EventFrame) => void = () => undefined;
    let onError: () => void = () => undefined;
    let closed = false;
    let streamId: number | undefined;
    const channel = new Channel<
      { kind: "event"; event: string; data: string } | { kind: "error"; message: string }
    >();
    channel.onmessage = (frame) => {
      if (closed) return;
      if (frame.kind === "error") onError();
      else onFrame({ type: frame.event, data: frame.data });
    };
    const cancel = (id: number) => {
      void invoke("kenkui_events_close", { id }).catch(() => undefined);
    };
    void invoke("kenkui_events_open", { url, channel }).then((id) => {
      streamId = id as number;
      // Close can race the IPC response when React unmounts or reconnects.
      if (closed) cancel(streamId);
    }).catch(() => { if (!closed) onError(); });

    return {
      onFrame: (listener) => { onFrame = listener; },
      onError: (listener) => { onError = listener; },
      close: () => {
        if (closed) return;
        closed = true;
        channel.onmessage = () => undefined;
        if (streamId !== undefined) cancel(streamId);
      },
    };
  };
}

type DownloadFrame =
  | { kind: "progress"; received: number; total?: number | null }
  | { kind: "complete" | "cancelled" | "sharing" }
  | { kind: "error"; message: string };

export function downloadArtifact(invoke: Invoke, url: string, path: string | undefined, options: SaveArtifactOptions = {}, suggestedName?: string): Promise<void> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let id: number | undefined;
    let done = false;
    const channel = new Channel<DownloadFrame>();
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      options.signal?.removeEventListener("abort", cancel);
      channel.onmessage = () => undefined;
      if (error) reject(error); else resolve();
    };
    const cancel = () => {
      if (id !== undefined && !done) {
        void invoke("kenkui_download_cancel", { id }).catch((cause) => finish(new Error(String(cause))));
      }
    };
    channel.onmessage = (frame) => {
      if (done) return;
      if (frame.kind === "progress") options.onProgress?.(frame);
      else if (frame.kind === "sharing") options.onProgress?.({ received: 0, phase: "sharing" });
      else if (frame.kind === "complete") finish();
      else if (frame.kind === "cancelled") finish(new DOMException("Download cancelled", "AbortError"));
      else if (frame.kind === "error") finish(new Error(frame.message));
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    void invoke("kenkui_download_start", { url, path, ...(suggestedName ? { suggestedName } : {}), channel }).then((result) => {
      id = result as number;
      if (options.signal?.aborted) cancel();
    }).catch((cause) => finish(new Error(String(cause))));
  });
}

export async function createHost(): Promise<Host> {
  const invoke = tauriInvoke as unknown as Invoke;
  const platform = await osPlatform();
  const can = hostCapabilitiesFor(platform);

  return {
    platform: can.reachLoopback ? "desktop" : "mobile",
    can,
    auth: createNativeAuth(invoke),
    transport: (baseUrl) => ({
      fetch: nativeFetch(invoke, baseUrl),
      eventSource: channelEventSourceFactory(openEventChannel(invoke)),
    }),
    servers: createServerRegistry(
      await load("servers.json", { autoSave: false }),
      can,
      (url) => nativeFetch(invoke, new URL(url).origin, 10_000)(url),
      import.meta.env.VITE_KENKUI_NATIVE_API_ORIGIN || "https://api.kenkui.fm",
    ),
    saveArtifact: async (artifact, suggestedName, options) => {
      if (!can.saveToPath) {
        await downloadArtifact(invoke, artifact.url, undefined, options, suggestedName);
        return;
      }
      options?.signal?.throwIfAborted();
      const path = await save({ defaultPath: suggestedName });
      if (!path) return;
      options?.signal?.throwIfAborted();
      await downloadArtifact(invoke, artifact.url, path, options);
    },
    openExternal: async (url) => { await openUrl(url); },
    onResume: (listener) => subscribeToResume(listener, !can.reachLoopback),
  };
}

async function openUrl(url: string): Promise<void> { await openExternalUrl(url); }

/** Listener registration is asynchronous; unsubscribe can precede its completion. */
export function subscribeToResume(listener: () => void, mobile: boolean): () => void {
  let closed = false;
  let unlisten: (() => void) | undefined;
  const wake = () => { if (!closed) listener(); };
  const visible = () => { if (document.visibilityState === "visible") wake(); };
  if (mobile) {
    void listen("kenkui:resume", wake).then((off) => {
      if (closed) off(); else unlisten = off;
    }).catch(() => {
      // Retain a recovery path if native event registration fails.
      if (!closed) document.addEventListener("visibilitychange", visible);
    });
  } else document.addEventListener("visibilitychange", visible);
  return () => {
    closed = true;
    unlisten?.();
    document.removeEventListener("visibilitychange", visible);
  };
}
