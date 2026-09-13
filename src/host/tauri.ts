import { invoke as tauriInvoke, Channel } from "@tauri-apps/api/core";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { load } from "@tauri-apps/plugin-store";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { openUrl as openExternalUrl } from "@tauri-apps/plugin-opener";
import type { Host, HostCapabilities, ServerEntry } from "./index";
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
    servers: await createNativeRegistry(can),
    saveArtifact: async (artifact, suggestedName) => { await saveBlob(await artifact.load(), suggestedName, can); },
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

const cloud: ServerEntry = {
  id: "cloud", label: "Kenkui Cloud", baseUrl: "https://api.kenkui.example", kind: "cloud",
};

function isLoopback(baseUrl: string): boolean {
  const host = new URL(baseUrl).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

async function createNativeRegistry(can: HostCapabilities): Promise<Host["servers"]> {
  const store = await load("servers.json", { autoSave: true });
  const read = async () => (await store.get<ServerEntry[]>("entries")) ?? [cloud];
  const write = async (entries: ServerEntry[]) => { await store.set("entries", entries); };

  return {
    list: read,
    selected: async () => {
      const entries = await read();
      const id = await store.get<string>("selected");
      return entries.find((entry) => entry.id === id) ?? entries[0];
    },
    select: async (id) => { await store.set("selected", id); },
    add: async (baseUrl, label) => {
      const url = new URL(baseUrl);
      if (!can.reachLoopback && isLoopback(baseUrl)) {
        throw new Error("This device cannot reach a loopback address.");
      }
      const probe = await nativeFetch(tauriInvoke as unknown as Invoke, url.origin)(`${url.origin}/v1/capabilities`);
      if (!probe.ok) throw new Error(`That server answered ${probe.status}.`);

      const entry: ServerEntry = { id: url.origin, label: label ?? url.host, baseUrl: url.origin, kind: "custom" };
      await write([...(await read()).filter((existing) => existing.id !== entry.id), entry]);
      return entry;
    },
    remove: async (id) => { await write((await read()).filter((entry) => entry.id !== id)); },
  };
}

async function saveBlob(blob: Blob, name: string, can: HostCapabilities): Promise<void> {
  if (!can.saveToPath) throw new Error("This device cannot save to a chosen path.");
  const path = await save({ defaultPath: name });
  if (!path) return;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}

async function openUrl(url: string): Promise<void> { await openExternalUrl(url); }
