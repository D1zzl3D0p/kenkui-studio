import { expectedAuthority } from "./authorities";
import { createAuthClient } from "@neon/auth";
import { BetterAuthVanillaAdapter } from "@neon/auth/vanilla/adapters";
import { KenkuiApiError, asApiError } from "../api/errors";
import type { Host } from "../host";

type Provider = "google" | "github";
function managedClient(issuer: string) {
  return createAuthClient(issuer, {
    allowAnonymous: false,
    adapter: BetterAuthVanillaAdapter({
      fetchOptions: { credentials: "include" },
      sessionOptions: {
        refetchInterval: 0,
        refetchOnWindowFocus: false,
        refetchWhenOffline: false,
      },
    }),
  });
}
type Managed = Pick<
  ReturnType<typeof managedClient>,
  "getSession" | "token" | "signIn" | "signOut"
>;
const loginRequired = () => new KenkuiApiError(401, "Sign in to continue.");
export function browserSession(
  base: string,
  fetcher: typeof fetch = fetch,
  create: (issuer: string) => Managed = managedClient,
) {
  const origin = new URL(base || location.origin).origin;
  let managed: Managed | undefined;
  let loading: Promise<Managed> | undefined;
  const listeners = new Set<() => void>();
  async function initialize() {
    if (managed) return managed;
    loading ??= (async () => {
      const trusted = expectedAuthority(
        origin,
        import.meta.env.VITE_KENKUI_AUTH_AUTHORITIES,
      );
      const response = await fetcher(origin + "/v1/auth/native/config", {
        credentials: "omit",
        redirect: "error",
      });
      if (!response.ok)
        throw new Error("Sign-in configuration is unavailable.");
      const config = await response.json();
      if (
        config.protocolVersion !== 2 ||
        config.issuer !== trusted.issuer ||
        config.jwksUrl !== trusted.jwksUrl ||
        config.resource !== trusted.resource ||
        config.clientId !== trusted.clientId
      )
        throw new Error(
          "The server sign-in configuration does not match this Studio build.",
        );
      managed = create(trusted.issuer);
      return managed;
    })().finally(() => {
      loading = undefined;
    });
    return loading;
  }
  let resuming: Promise<void> | undefined;
  const auth: NonNullable<Host["auth"]> = {
    providers: ["google", "github"],
    async restore() {
      if (document.visibilityState !== "visible") return;
      resuming ??= (async () => {
        const result = await (await initialize()).getSession();
        if (result.error && result.error.status !== 401)
          throw new Error("Could not check your sign-in.");
        if (!result.data?.session) throw loginRequired();
      })().finally(() => {
        resuming = undefined;
      });
      return resuming;
    },
    async signIn(_origin, provider?: Provider) {
      if (provider !== "google" && provider !== "github")
        throw new Error("Choose a sign-in provider.");
      const { error } = await (
        await initialize()
      ).signIn.social({ provider, callbackURL: location.origin + "/" });
      if (error) throw new Error("Could not start sign-in.");
    },
    async cancelSignIn() {},
    async signOut() {
      const { error } = await (await initialize()).signOut();
      if (error) throw new Error("Could not sign out. Please try again.");
      listeners.forEach((listener) => listener());
    },
    onChanged(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input), location.origin);
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      !url.pathname.startsWith("/v1/")
    )
      throw new Error("Request is outside the selected API.");
    const headers = new Headers(init?.headers);
    if (managed && url.pathname !== "/v1/capabilities") {
      if (document.visibilityState !== "visible")
        throw new Error("Resume Studio before making a request.");
      const result = await managed.token();
      const data = result.data as {
        token?: string;
        session?: { token?: string };
      } | null;
      const token = data?.token ?? data?.session?.token;
      if (result.error && result.error.status !== 401)
        throw new Error("Could not obtain sign-in credentials.");
      if (!token) return new Response(null, { status: 401 });
      headers.set("Authorization", "Bearer " + token);
    }
    return fetcher(url.href, {
      ...init,
      headers,
      credentials: "omit",
      redirect: "error",
    });
  };
  async function downloadUrl(url: string) {
    if (!managed) return url;
    const response = await request(url + "-url");
    if (!response.ok) {
      const error = await asApiError(response);
      if (error.status === 401 || error.code === "recovery_required")
        listeners.forEach((fn) => fn());
      throw error;
    }
    const signed = new URL((await response.json()).url);
    if (
      signed.protocol !== "https:" ||
      signed.username ||
      signed.password ||
      signed.hash
    )
      throw new Error("Invalid download address.");
    return signed.href;
  }
  return { auth, request, downloadUrl, hosted: () => Boolean(managed) };
}
