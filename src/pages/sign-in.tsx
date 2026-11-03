import type { Capabilities } from "../api/generated/v1";
import type { KenkuiServerClient } from "../api/client";
import type { Host } from "../host";
import { NativeAuthAction } from "../components/native-auth-action";

export function SignInPage({ capabilities, client, auth }: { capabilities: Capabilities; client: KenkuiServerClient; auth?: Host["auth"] }) {
  if (capabilities.auth?.mode === "none") return <section className="sign-in-panel"><h1>Sign in</h1><p>This server does not require sign-in.</p></section>;
  return <section className="sign-in-panel"><h1>Sign in to your studio</h1><p>Sign in once more with Google or GitHub after the account migration. You can then recover your existing books and credits.</p>{auth
    ? <NativeAuthAction auth={auth} origin={client.storageScope()} action="signIn" />
    : <p>Sign-in is unavailable on this platform.</p>}</section>;
}
