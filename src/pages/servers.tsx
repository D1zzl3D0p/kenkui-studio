import { useEffect, useState } from "react";
import type { Host, ServerEntry } from "../host/index";
import { ErrorMessage } from "../components/error-message";

interface ServersPageProps { host: Host; onSelect: () => void }

export function ServersPage({ host, onSelect }: ServersPageProps) {
  const [entries, setEntries] = useState<ServerEntry[]>();
  const [address, setAddress] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const refresh = () => { void host.servers.list().then(setEntries).catch(setError); };
  useEffect(refresh, [host]);

  const choose = async (id: string) => {
    setBusy(true);
    setError(undefined);
    try { await host.auth?.cancelSignIn(); await host.servers.select(id); onSelect(); } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  };
  const add = async () => {
    setBusy(true);
    setError(undefined);
    try { await host.servers.add(address); setAddress(""); setEntries(await host.servers.list()); }
    catch (cause) { setError(cause); }
    finally { setBusy(false); }
  };

  return <main><h1>Servers</h1><ErrorMessage error={error} />
    <ul>{entries?.map((entry) => <li key={entry.id}>
      {entry.label} <span>{entry.baseUrl}</span>
      <button type="button" disabled={busy} onClick={() => void choose(entry.id)}>Use {entry.label}</button>
    </li>)}</ul>
    <form onSubmit={(event) => { event.preventDefault(); if (!busy) void add(); }}>
      <label htmlFor="server-address">Server address</label>
      <input id="server-address" type="url" required disabled={busy} autoCapitalize="none"
        autoCorrect="off" spellCheck={false} placeholder="https://your-server.example"
        value={address} onChange={(event) => setAddress(event.target.value)} />
      <button type="submit" disabled={busy || !address.trim()}>Add server</button>
    </form>
    {busy && <p role="status">Connecting to your server…</p>}
  </main>;
}
