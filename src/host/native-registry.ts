import type { HostCapabilities, ServerEntry, ServerRegistry } from "./index";
import { isSupportedApiVersion } from "./version";

export interface RegistryStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
}

export function serverOrigin(address: string, can: HostCapabilities): string {
  const url = new URL(address.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("Enter an HTTP or HTTPS server address without embedded credentials.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Enter the server origin only, without a path, query or fragment.");
  }
  const hostname = url.hostname;
  if (!can.reachLoopback && (
    hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.startsWith("127.") || hostname === "[::1]"
  )) {
    throw new Error("Use your server's network address; this device cannot reach your computer through loopback.");
  }
  return url.origin;
}

export function createServerRegistry(
  store: RegistryStore,
  can: HostCapabilities,
  probe: (url: string) => Promise<Response>,
  cloudAddress: string,
): ServerRegistry {
  const cloud: ServerEntry = {
    id: "cloud", label: "Kenkui Cloud", baseUrl: serverOrigin(cloudAddress, can), kind: "cloud",
  };
  const read = async (): Promise<ServerEntry[]> => {
    const raw = await store.get<unknown>("entries");
    const entries: ServerEntry[] = [cloud];
    if (!Array.isArray(raw)) return entries;
    for (const value of raw) {
      if (!value || typeof value !== "object" || value.kind !== "custom" ||
          typeof value.baseUrl !== "string" || typeof value.label !== "string") continue;
      try {
        const origin = serverOrigin(value.baseUrl, can);
        if (!entries.some((entry) => entry.id === origin)) {
          entries.push({ id: origin, label: value.label, baseUrl: origin, kind: "custom" });
        }
      } catch { /* Keep valid entries usable when an older or corrupt record exists. */ }
    }
    return entries;
  };
  const write = async (entries: ServerEntry[]) => {
    await store.set("entries", entries);
    await store.save();
  };
  return {
    list: read,
    selected: async () => {
      const id = await store.get<unknown>("selected");
      return (await read()).find((entry) => entry.id === id);
    },
    select: async (id) => {
      if (!(await read()).some((entry) => entry.id === id)) {
        throw new Error("Choose a server from the list.");
      }
      await store.set("selected", id);
      // Persist before the existing server-switch UI reloads the WebView.
      await store.save();
    },
    add: async (address, label) => {
      const origin = serverOrigin(address, can);
      const response = await probe(`${origin}/v1/capabilities`);
      if (!response.ok) throw new Error(`That server answered ${response.status}.`);
      let capabilities: unknown;
      try { capabilities = await response.json(); }
      catch { throw new Error("That address did not return Kenkui server capabilities."); }
      if (!capabilities || typeof capabilities !== "object" ||
          !("apiVersion" in capabilities) || typeof capabilities.apiVersion !== "string" ||
          !isSupportedApiVersion({ apiVersion: capabilities.apiVersion })) {
        throw new Error("That server does not support this version of Kenkui Studio.");
      }
      const entry: ServerEntry = {
        id: origin, label: label?.trim() || new URL(origin).host, baseUrl: origin, kind: "custom",
      };
      await write([...(await read()).filter((item) => item.id !== entry.id), entry]);
      return entry;
    },
    remove: async (id) => {
      if (id === cloud.id) throw new Error("The built-in Cloud server cannot be removed.");
      await write((await read()).filter((entry) => entry.id !== id));
      // A removed/stale selection intentionally returns to the picker on startup.
    },
  };
}
