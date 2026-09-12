import { invoke as tauriInvoke, Channel } from "@tauri-apps/api/core";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import type { Host, HostCapabilities } from "./index";
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
export function nativeFetch(invoke: Invoke, baseUrl: string, token?: string): typeof globalThis.fetch {
  const trusted = baseUrl ? new URL(baseUrl).origin : "";
  return async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    const headers = [...new Headers(init?.headers).entries()];
    if (token && trusted && new URL(url).origin === trusted) {
      headers.push(["Authorization", `Bearer ${token}`]);
    }
    const body = init?.body === undefined || init.body === null
      ? undefined
      : Array.from(new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer()));

    const response = await invoke("kenkui_request", {
      spec: { url, method: (init?.method ?? "GET").toUpperCase(), headers, body },
    }) as { status: number; headers: [string, string][]; body: number[] };

    return new Response(new Uint8Array(response.body), {
      status: response.status,
      headers: new Headers(response.headers),
    });
  };
}

function openEventChannel(invoke: Invoke): (url: string) => EventChannel {
  return (url) => {
    let onFrame: (frame: EventFrame) => void = () => undefined;
    let onError: () => void = () => undefined;
    const channel = new Channel<{ event: string; data: string }>();
    channel.onmessage = (frame) => onFrame({ type: frame.event, data: frame.data });
    void invoke("kenkui_events_open", { url, channel }).catch(() => onError());

    return {
      onFrame: (listener) => { onFrame = listener; },
      onError: (listener) => { onError = listener; },
      close: () => { channel.onmessage = () => undefined; },
    };
  };
}

export async function createHost(): Promise<Host> {
  const invoke = tauriInvoke as unknown as Invoke;
  const platform = await osPlatform();
  const can = hostCapabilitiesFor(platform);

  return {
    platform: can.reachLoopback ? "desktop" : "mobile",
    can,
    transport: (baseUrl) => ({
      fetch: nativeFetch(invoke, baseUrl),
      eventSource: channelEventSourceFactory(openEventChannel(invoke)),
    }),
    servers: await createNativeRegistry(),
    saveArtifact: async (blob, suggestedName) => { await saveBlob(blob, suggestedName, can); },
    openExternal: async (url) => { await openUrl(url); },
    onResume: (listener) => {
      // Desktop webviews stay resident, so visibilitychange is sufficient here.
      // Mobile replaces this with the platform lifecycle event at mobile release.
      const wake = () => { if (document.visibilityState === "visible") listener(); };
      document.addEventListener("visibilitychange", wake);
      return () => document.removeEventListener("visibilitychange", wake);
    },
  };
}

async function createNativeRegistry(): Promise<Host["servers"]> {
  throw new Error("The native server registry is not implemented yet.");
}
async function saveBlob(_blob: Blob, _name: string, _can: HostCapabilities): Promise<void> {
  throw new Error("Native artifact saving is not implemented yet.");
}
async function openUrl(_url: string): Promise<void> {
  throw new Error("Opening external links is not implemented yet.");
}
