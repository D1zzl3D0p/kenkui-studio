import { useEffect, useState } from "react";
import type { Capabilities } from "./api/generated/v1";
import { KenkuiServerClient } from "./api/client";
import { ErrorMessage } from "./components/error-message";
import { ServersPage } from "./pages/servers";
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
  useEffect(() => {
    let live = true;
    setError(undefined);
    setCap(undefined);
    setIdentity(undefined);
    void client
      .capabilities()
      .then(async (value) => {
        if (!live) return;
        setCap(value);
        if (!isSupportedApiVersion(value)) return;
        const id =
          value.auth?.mode === "none"
            ? "local"
            : (await client.session()).userId;
        if (live) setIdentity(id);
      })
      .catch((cause) => {
        if (live) setError(cause);
      });
    return () => {
      live = false;
    };
  }, [client, retry]);
  if (servers && host.can.chooseServer)
    return (
      <main>
        <ServersPage host={host} onSelect={() => window.location.reload()} />
      </main>
    );
  if (error)
    return (
      <main className="connection-screen">
        <h1>Kenkui Studio</h1>
        <ErrorMessage error={error} />
        {cap?.auth?.mode && cap.auth.mode !== "none" && (
          <SignInPage capabilities={cap} client={client} />
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
