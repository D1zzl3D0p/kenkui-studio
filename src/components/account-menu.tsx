import { useEffect, useId, useRef, useState } from "react";
import type { KenkuiServerClient } from "../api/client";
import type { Host } from "../host";
import { NativeAuthAction } from "./native-auth-action";
import { NotificationSettings } from "./notification-settings";
import type { Capabilities } from "../api/generated/v1";

export function AccountMenu({ client, signedIn, initiallyOpen = false, auth, host, capabilities }: {
  client: KenkuiServerClient;
  signedIn: boolean;
  initiallyOpen?: boolean;
  auth?: Host["auth"];
  /** Both are needed to offer notification settings; omitted before sign-in. */
  host?: Host;
  capabilities?: Capabilities;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return <div className="account-menu" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} className="icon-button account-trigger" aria-label="Account"
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2" />
      </svg>
    </button>
    {open && <div id={id} className="account-popover">
      <p className="quiet">{signedIn ? "Signed in" : "Your account"}</p>
      {signedIn && host && capabilities &&
        <NotificationSettings client={client} host={host} capabilities={capabilities} />}
      {auth ? <NativeAuthAction auth={auth} origin={client.storageScope()} action={signedIn ? "signOut" : "signIn"} /> : signedIn
        ? <form method="post" action={client.authUrl("logout")}><button className="secondary full" type="submit">Sign out</button></form>
        : <a className="primary" href={client.authUrl("login")}>Sign in</a>}
    </div>}
  </div>;
}
