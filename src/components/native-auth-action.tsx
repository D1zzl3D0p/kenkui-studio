import { useState } from "react";
import type { Host } from "../host";
import { ErrorMessage } from "./error-message";

export function NativeAuthAction({ auth, origin, action }: {
  auth: NonNullable<Host["auth"]>;
  origin: string;
  action: "signIn" | "signOut";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const run = async () => {
    setError(undefined);
    setBusy(true);
    try { await auth[action](origin); }
    catch (cause) { setError(cause); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" className={action === "signIn" ? "primary" : "secondary full"}
      disabled={busy} onClick={() => void run()}>
      {busy ? (action === "signIn" ? "Waiting for browser…" : "Signing out…") : (action === "signIn" ? "Sign in" : "Sign out")}
    </button>
    {busy && action === "signIn" && <>
      <p role="status">Complete sign-in in your browser, then return here.</p>
      <button type="button" className="text-button" onClick={() => void auth.cancelSignIn().catch(setError)}>Cancel sign-in</button>
    </>}
    <ErrorMessage error={error} />
  </>;
}
