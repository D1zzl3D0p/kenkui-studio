import type { Host } from "./index";

/** Only actions cross IPC. Credential values never enter the WebView. */
export function createNativeAuth(invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>): NonNullable<Host["auth"]> {
  const listeners = new Set<() => void>();
  const call = async (command: string, args: Record<string, unknown>) => {
    try { await invoke(command, args); }
    catch (cause) { throw new Error(typeof cause === "string" ? cause : "Native authentication failed. Please try again."); }
  };
  return {
    restore: (origin) => call("kenkui_auth_restore", { origin }),
    signIn: async (origin) => {
      await call("kenkui_auth_sign_in", { origin });
      listeners.forEach((listener) => listener());
    },
    cancelSignIn: () => call("kenkui_auth_cancel", {}),
    signOut: async (origin) => {
      await call("kenkui_auth_sign_out", { origin });
      listeners.forEach((listener) => listener());
    },
    onChanged: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
