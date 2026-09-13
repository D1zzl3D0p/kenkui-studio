import { useEffect, useState } from "react";
import type { Host, ServerEntry } from "../host/index";
import { ErrorMessage } from "../components/error-message";

interface ServersPageProps { host: Host; onSelect: () => void }

export function ServersPage({ host, onSelect }: ServersPageProps) {
  const [entries, setEntries] = useState<ServerEntry[]>();
  const [address, setAddress] = useState("");
  const [error, setError] = useState<unknown>();
  const refresh = () => { void host.servers.list().then(setEntries).catch(setError); };
  useEffect(refresh, [host]);

  const choose = async (id: string) => {
    try { await host.servers.select(id); onSelect(); } catch (cause) { setError(cause); }
  };
  const add = async () => {
    try { await host.servers.add(address); setAddress(""); refresh(); } catch (cause) { setError(cause); }
  };

  return <main><h1>Servers</h1><ErrorMessage error={error} />
    <ul>{entries?.map((entry) => <li key={entry.id}>
      {entry.label} <span>{entry.baseUrl}</span>
      <button type="button" onClick={() => void choose(entry.id)}>Use {entry.label}</button>
    </li>)}</ul>
    <label htmlFor="server-address">Server address</label>
    <input id="server-address" value={address} onChange={(event) => setAddress(event.target.value)} />
    <button type="button" onClick={() => void add()}>Add server</button>
  </main>;
}
