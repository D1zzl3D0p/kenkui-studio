import { useEffect, useState } from "react";
import type { Capabilities } from "../api/generated/v1";
import { KenkuiServerClient } from "../api/client";
import { ErrorMessage } from "../components/error-message";

export function BillingPage({ client, capabilities }: { client: KenkuiServerClient; capabilities: Capabilities }) {
  const [billing, setBilling] = useState<Record<string, string>>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    if (capabilities.billing?.mode !== "credits") return;
    void client.billing().then(setBilling).catch(setError);
  }, [client, capabilities.billing?.mode]);
  if (capabilities.billing?.mode !== "credits") return <main><h1>Billing</h1><p>Billing is unavailable on this server.</p></main>;
  return <main><h1>Billing</h1><p>Your beta allowance covers audiobook creation. Failed or cancelled jobs release their reserved credits.</p><ErrorMessage error={error} />{billing && <p>Available: {billing.availableCredits ?? "0"} credits. One credit covers 1,000 normalized speech characters.</p>}</main>;
}
