import type { Host, ServerEntry } from "./index";

/**
 * The browser host. The SPA talks to one fixed API: the origin it was served
 * from, or the origin the build was configured with when app and API are split.
 */
export async function createHost(
  { navigate = (url: string) => window.location.assign(url) }: { navigate?: (url: string) => void } = {},
): Promise<Host> {
  const origin: ServerEntry = { id: "origin", label: "This server", baseUrl: import.meta.env.VITE_KENKUI_API_ORIGIN ?? "", kind: "origin" };
  return {
    platform: "web",
    can: { chooseServer: false, reachLoopback: true, manageLocalServer: false, saveToPath: false },
    transport: () => ({}),
    servers: {
      list: async () => [origin],
      selected: async () => origin,
      select: async () => undefined,
      add: async () => { throw new Error("The web app does not support choosing a server."); },
      remove: async () => { throw new Error("The web app does not support choosing a server."); },
    },
    // Navigating lets the browser stream a large M4B with its own credentials.
    saveArtifact: async ({ url }) => { navigate(url); },
    openExternal: async (url) => { navigate(url); },
    onResume: (listener) => {
      const wake = () => { if (document.visibilityState === "visible") listener(); };
      document.addEventListener("visibilitychange", wake);
      return () => document.removeEventListener("visibilitychange", wake);
    },
  };
}
