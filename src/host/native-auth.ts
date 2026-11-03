import type { Host } from "./index";

/** Only actions cross IPC. Credential values never enter the WebView. */
export function createNativeAuth(invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>): NonNullable<Host["auth"]> {
  const listeners = new Set<(notice?: string) => void>();
  const call = async (command: string, args: Record<string, unknown>) => {
    try { return await invoke(command, args); }
    catch (cause) { throw new Error(typeof cause === "string" ? cause : "Native authentication failed. Please try again."); }
  };
  return {
    restore: async (origin) => { await call("kenkui_auth_restore", {origin}); },
    signIn: async (origin) => {
      await call("kenkui_auth_sign_in", { origin });
      listeners.forEach((listener) => listener());
    },
    cancelSignIn: async () => { await call("kenkui_auth_cancel", {}); },
    signOut: async (origin) => {
      const revoked = await call("kenkui_auth_sign_out", { origin });
      listeners.forEach(listener => listener(revoked === false ? "Signed out on this device. The sign-in service could not confirm remote revocation." : undefined));
    },
    onChanged: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
