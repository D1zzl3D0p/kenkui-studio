import { useEffect, useState } from "react";
import type { Capabilities } from "../api/generated/v1";
import { KenkuiServerClient } from "../api/client";
import { ErrorMessage } from "../components/error-message";

export function BillingPage({ client, capabilities }: { client: KenkuiServerClient; capabilities: Capabilities }) {
  const [billing, setBilling] = useState<Record<string, string>>();
  const [error, setError] = useState<unknown>();
  const [buying, setBuying] = useState(false);
  const result = new URLSearchParams(window.location.search).get("checkout");
  useEffect(() => {
    if (capabilities.billing?.mode !== "credits") return;
    let active = true;
    const refresh = () => { void client.billing().then(value => { if (active) setBilling(value); }).catch(value => { if (active) setError(value); }); };
    refresh();
    // A redirect can arrive before Stripe delivers the payment webhook.
    const timer = result === "success" ? window.setInterval(refresh, 3000) : undefined;
    const stop = timer === undefined ? undefined : window.setTimeout(() => window.clearInterval(timer), 60000);
    return () => { active = false; window.clearInterval(timer); window.clearTimeout(stop); };
  }, [client, capabilities.billing?.mode, result]);
  async function buy(credits: number) {
    setBuying(true);
    setError(undefined);
    try { const session = await client.checkout(credits); window.location.assign(session.url); }
    catch (value) { setError(value); setBuying(false); }
  }
  if (capabilities.billing?.mode !== "credits") return <main><h1>Billing</h1><p>Billing is unavailable on this server.</p></main>;
  return <main>
    <h1>Billing</h1>
    <p>100 credits = $1 USD. Each book is priced by length and estimated processing cost, with a 50% premium for multi-voice narration. You see the price before starting.</p>
    <p>Failed or cancelled jobs release their reserved credits.</p>
    {result === "success" && <p role="status">Checkout complete. Credits appear after payment is confirmed. Your balance refreshes automatically for one minute; refresh this page if confirmation takes longer.</p>}
    {result === "cancelled" && <p role="status">Checkout cancelled. You can try again whenever you’re ready.</p>}
    <ErrorMessage error={error} />
    {billing && <p>Available: {billing.availableCredits ?? "0"} credits (${(Number(billing.availableCredits ?? 0) / 100).toFixed(2)}).</p>}
    <h2>Add credits</h2>
    {billing?.checkoutEnabled === "true" ? <div>{[500, 1000, 2000].map(credits => <button key={credits} type="button" disabled={buying} onClick={() => void buy(credits)}>Buy {credits.toLocaleString("en-US")} credits — ${credits / 100}</button>)}<p>Pay securely through Stripe. Applicable tax is added at checkout. Local-currency prices may vary; your credit pack stays the same.</p></div> : <p>Card payments are not available yet.</p>}
  </main>;
}
