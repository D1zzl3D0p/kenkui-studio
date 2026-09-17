import type { Capabilities } from "../api/generated/v1";
import type { KenkuiServerClient } from "../api/client";

export function SignInPage({ capabilities, client }: { capabilities: Capabilities; client: KenkuiServerClient }) {
  if (capabilities.auth?.mode === "none") return <section className="sign-in-panel"><h1>Sign in</h1><p>This server does not require sign-in.</p></section>;
  return <section className="sign-in-panel"><h1>Sign in to your studio</h1><p>Sign in to access your books and saved drafts.</p><a className="primary" href={client.authUrl("login")}>Sign in</a></section>;
}
