import { useEffect, useState } from "react";
import type { Host, LocalServerStatus, ServerEntry } from "../host/index";
import { ErrorMessage } from "../components/error-message";

interface ServersPageProps { host: Host; onSelect: () => void }

export function ServersPage({ host, onSelect }: ServersPageProps) {
  const [entries, setEntries] = useState<ServerEntry[]>();
  const [address, setAddress] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [localStatus, setLocalStatus] = useState<LocalServerStatus>();
  const refresh = () => { void host.servers.list().then(setEntries).catch(setError); };
  useEffect(refresh, [host]);
  useEffect(() => {
    if (!host.localServer) return;
    let active = true;
    const update = () => { void host.localServer!.status().then((status) => {
      if (active) setLocalStatus(status);
    }).catch((cause) => { if (active) setError(cause); }); };
    update();
    const timer = window.setInterval(update, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [host]);

  const stopLocal = async () => {
    setError(undefined);
    try { setLocalStatus(await host.localServer!.stop()); }
    catch (cause) { setError(cause); }
  };

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
    {host.localServer && <section aria-label="Local server">
      <p>Local server: {localStatus?.state ?? "checking"}</p>
      {localStatus?.state === "starting" && <p role="status">
        {localStatus.progress ?? "Starting local server…"}
        {" "}First startup downloads the voice models and may take several minutes.
      </p>}
      {localStatus?.error && <p role="alert">{localStatus.error}</p>}
      <button type="button" onClick={() => void stopLocal()}
        disabled={!localStatus || !["starting", "running"].includes(localStatus.state)}>
        Stop local server
      </button>
    </section>}
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
