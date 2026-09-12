import type { Host, ServerEntry } from "./index";

const origin: ServerEntry = { id: "origin", label: "This server", baseUrl: "", kind: "origin" };

/** The browser host. The SPA talks to the origin it was served from and nothing else. */
export async function createHost(): Promise<Host> {
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
    saveArtifact: async (blob, suggestedName) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = suggestedName;
      link.click();
      URL.revokeObjectURL(url);
    },
    openExternal: async (url) => { window.location.assign(url); },
    onResume: (listener) => {
      const wake = () => { if (document.visibilityState === "visible") listener(); };
      document.addEventListener("visibilitychange", wake);
      return () => document.removeEventListener("visibilitychange", wake);
    },
  };
}
