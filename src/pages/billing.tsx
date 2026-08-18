import { useEffect, useState } from "react";
import type { Capabilities } from "../api/generated/v1";
import { KenkuiServerClient } from "../api/client";
import { ErrorMessage } from "../components/error-message";

export function BillingPage({ client, capabilities }: { client: KenkuiServerClient; capabilities: Capabilities }) {
  const [billing, setBilling] = useState<Record<string, string>>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    if (capabilities.billing.mode !== "credits") return;
    void client.billing().then(setBilling).catch(setError);
  }, [client, capabilities.billing.mode]);
  if (capabilities.billing.mode !== "credits") return <main><h1>Billing</h1><p>Billing is unavailable on this server.</p></main>;
  return <main><h1>Billing</h1><p>Billing mode: {capabilities.billing.mode}</p><ErrorMessage error={error} />{billing && <dl>{Object.entries(billing).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}</main>;
}
