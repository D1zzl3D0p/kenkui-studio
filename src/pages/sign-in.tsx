import type { Capabilities } from "../api/generated/v1";
import type { KenkuiServerClient } from "../api/client";
import type { Host } from "../host";
import { NativeAuthAction } from "../components/native-auth-action";

export function SignInPage({ capabilities, client, auth }: { capabilities: Capabilities; client: KenkuiServerClient; auth?: Host["auth"] }) {
  if (capabilities.auth?.mode === "none") return <section className="sign-in-panel"><h1>Sign in</h1><p>This server does not require sign-in.</p></section>;
  return <section className="sign-in-panel"><h1>Sign in to your studio</h1><p>Sign in to access your books and saved drafts.</p>{auth
    ? <NativeAuthAction auth={auth} origin={client.storageScope()} action="signIn" />
    : <a className="primary" href={client.authUrl("login")}>Sign in</a>}</section>;
}
