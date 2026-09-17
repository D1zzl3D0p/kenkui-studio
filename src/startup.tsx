import { useEffect, useState } from "react";
import { App } from "./app";
import { KenkuiServerClient } from "./api/client";
import type { Host } from "./host";
import { ServersPage } from "./pages/servers";
import { ErrorMessage } from "./components/error-message";

type StartupState = {
  host?: Host;
  client?: KenkuiServerClient;
  error?: Error;
  loading: boolean;
};

/** Mount a recoverable shell before asynchronous native initialization begins. */
export function Startup({ loadHost }: { loadHost: () => Promise<Host> }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<StartupState>({ loading: true });
  useEffect(() => {
    let live = true;
    let host: Host | undefined;
    setState({ loading: true });
    void (async () => {
      host = await loadHost();
      const server = await host.servers.selected();
      if (!server && !host.can.chooseServer) throw new Error("No server is configured.");
      const client = server
        ? new KenkuiServerClient(server.baseUrl, host.transport(server.baseUrl))
        : undefined;
      if (live) setState({ host, client, loading: false });
    })().catch((cause) => {
      if (live) setState({ host, error: cause instanceof Error ? cause : new Error(String(cause)), loading: false });
    });
    return () => { live = false; };
  }, [attempt, loadHost]);

  if (state.loading) return <main className="connection-screen"><h1>Kenkui Studio</h1><p role="status">Opening your studio…</p></main>;
  if (state.host && state.client) return <App host={state.host} client={state.client} />;
  if (!state.error && state.host?.can.chooseServer) {
    return <ServersPage host={state.host} onSelect={() => setAttempt((value) => value + 1)} />;
  }
  return <main className="connection-screen">
    <h1>Could not open your studio</h1>
    <ErrorMessage error={state.error} />
    <button className="secondary" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
  </main>;
}
