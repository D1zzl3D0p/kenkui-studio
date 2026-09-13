import type { Capabilities } from "../api/generated/v1";
import type { KenkuiServerClient } from "../api/client";

export function SignInPage({ capabilities, client }: { capabilities: Capabilities; client: KenkuiServerClient }) {
  if (capabilities.auth?.mode === "none") return <main><h1>Sign in</h1><p>This server does not require sign-in.</p></main>;
  return <main><h1>Private beta</h1><p>Sign in with the email address invited to the beta.</p><a href={client.authUrl("login")}>Sign in</a><form method="post" action={client.authUrl("logout")}><button type="submit">Sign out</button></form></main>;
}
