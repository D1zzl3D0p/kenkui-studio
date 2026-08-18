import type { Capabilities } from "../api/generated/v1";

export function SignInPage({ capabilities }: { capabilities: Capabilities }) {
  return <main><h1>Sign in</h1><p>{capabilities.auth.mode === "none" ? "This server does not require sign-in." : `Authentication mode: ${capabilities.auth.mode}`}</p></main>;
}
