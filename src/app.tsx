import { RecoverAccount } from "./components/recover-account";
import { useEffect, useState } from "react";
import type { Capabilities } from "./api/generated/v1";
import { KenkuiServerClient } from "./api/client";
import { KenkuiApiError } from "./api/errors";
import { ErrorMessage } from "./components/error-message";
import { ServersPage } from "./pages/servers";
import { AccountMenu } from "./components/account-menu";
import { SignInPage } from "./pages/sign-in";
import type { Host } from "./host";
import { isSupportedApiVersion } from "./host/version";
import { Studio } from "./studio/studio";
import "./studio/style.css";
export function App({
  client,
  host,
  initialPath,
}: {
  client: KenkuiServerClient;
  host: Host;
  initialPath?: string;
}) {
  const [cap, setCap] = useState<Capabilities>(),
    [identity, setIdentity] = useState<string>(),
    [error, setError] = useState<unknown>();
  const [retry, setRetry] = useState(0),
    [servers, setServers] = useState(false);
  const [notice, setNotice] = useState<string>();
  useEffect(
    () =>
      host.auth?.onChanged((message) => {
        setNotice(message);
        setRetry((n) => n + 1);
      }),
    [host.auth],
  );
  useEffect(() => {
    try {
      document.documentElement.dataset.theme =
        localStorage.getItem("kenkui-studio-theme") || "system";
    } catch {
      document.documentElement.dataset.theme = "system";
    }
  }, []);
  useEffect(() => {
    let live = true;
    let checking = false;
    let revision = 0;
    let capabilities: Capabilities | undefined;
    setError(undefined);
    setCap(undefined);
    setIdentity(undefined);
    const unavailable = (cause: unknown) => {
      if (!live) return;
      revision++;
      setIdentity(undefined);
      setError(cause);
      if (cause instanceof KenkuiApiError && cause.status === 401)
        window.history.replaceState({}, "", "/");
    };
    const check = async () => {
      if (checking || document.visibilityState !== "visible") return;
      const current = revision;
      checking = true;
      try {
        if (!capabilities) {
          capabilities = await client.capabilities();
          if (!live) return;
          setCap(capabilities);
        }
        if (
          !isSupportedApiVersion(capabilities) ||
          document.visibilityState !== "visible"
        )
          return;
        let id = "local";
        if (capabilities.auth?.mode !== "none") {
          await host.auth?.restore(client.storageScope());
          if (!live || document.visibilityState !== "visible") return;
          id = (await client.session()).userId;
        }
        if (live && current === revision) {
          setIdentity(id);
          setError(undefined);
        }
      } catch (cause) {
        if (live && current === revision) unavailable(cause);
      } finally {
        checking = false;
      }
    };
    const offUnauthorized = client.onUnauthorized?.(() =>
      unavailable(new KenkuiApiError(401, "Sign in to your studio")),
    );
    const offRecovery = client.onRecoveryRequired?.(unavailable);
    const resume = host.onResume(() => void check());
    void check();
    return () => {
      live = false;
      offUnauthorized?.();
      offRecovery?.();
      resume();
    };
  }, [client, host, retry]);
  if (servers && host.can.chooseServer)
    return (
      <main>
        <ServersPage host={host} onSelect={() => window.location.reload()} />
      </main>
    );
  if (error instanceof KenkuiApiError && error.status === 409 && error.code === "recovery_required")
    return <>
      <header className="app-header"><a className="brand" href="/">Kenkui <span>Studio</span></a>
        <AccountMenu client={client} signedIn auth={host.auth}/></header>
      <RecoverAccount client={client} linked={() => setRetry(n => n + 1)}/>
    </>;
  if (error instanceof KenkuiApiError && error.status === 401 && cap && cap.auth?.mode !== "none")
    return <>
      <header className="app-header"><a className="brand" href="/">Kenkui <span>Studio</span></a></header>
      <main className="connection-screen">
        {notice && <p role="status">{notice}</p>}
        <SignInPage capabilities={cap} client={client} auth={host.auth} />
        {host.can.chooseServer && <button className="text-button" onClick={() => setServers(true)}>Choose another server</button>}
      </main>
    </>;
  if (error)
    return (
      <>
      <header className="app-header">
        <a className="brand" href="/">Kenkui <span>Studio</span></a>
        {cap?.auth?.mode && cap.auth.mode !== "none" && <AccountMenu client={client} signedIn={false} auth={host.auth} />}
      </header>
      <main className="connection-screen">
        <ErrorMessage error={error} />
        {cap?.auth?.mode && cap.auth.mode !== "none" && (
          <SignInPage capabilities={cap} client={client} auth={host.auth} />
        )}
        <button className="secondary" onClick={() => setRetry((n) => n + 1)}>
          Try again
        </button>
        {host.can.chooseServer && (
          <button className="text-button" onClick={() => setServers(true)}>
            Choose another server
          </button>
        )}
      </main>
      </>
    );
  if (cap && !isSupportedApiVersion(cap))
    return (
      <main>
        <h1>Kenkui Studio</h1>
        <p>
          This version of Kenkui Studio is too old to talk to this server.
          Update it through your package manager.
        </p>
      </main>
    );
  if (!cap || !identity)
    return (
      <main className="connection-screen">
        <h1>Kenkui Studio</h1>
        <p role="status">Connecting to your library…</p>
      </main>
    );
  const scope = `${client.storageScope()}::${identity}`;
  return (
    <Studio
      key={scope}
      client={client}
      host={host}
      cap={cap}
      scope={scope}
      initialPath={initialPath}
    />
  );
}
