import { useEffect, useState } from "react";
import type { Capabilities } from "../api/generated/v1";
import type { KenkuiServerClient } from "../api/client";
import { ErrorMessage } from "../components/error-message";
export function BillingPage({
  client,
  capabilities,
  onBack,
  onCheckout,
}: {
  client: KenkuiServerClient;
  capabilities: Capabilities;
  onBack?(): void;
  onCheckout?(url: string): Promise<void>;
}) {
  const [billing, setBilling] = useState<Record<string, string>>(),
    [error, setError] = useState<unknown>();
  const [buying, setBuying] = useState(false),
    [refresh, setRefresh] = useState(0);
  const result = new URLSearchParams(window.location.search).get("checkout");
  useEffect(() => {
    if (capabilities.billing?.mode !== "credits") return;
    let active = true;
    const fetch = () => {
      void client
        .billing()
        .then((value) => {
          if (active) {
            setBilling(value);
            setError(undefined);
          }
        })
        .catch((cause) => {
          if (active) setError(cause);
        });
    };
    fetch();
    const timer = result === "success" ? setInterval(fetch, 3000) : undefined;
    const stop = timer
      ? setTimeout(() => clearInterval(timer), 60000)
      : undefined;
    return () => {
      active = false;
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [client, capabilities.billing?.mode, result, refresh]);
  async function buy(credits: number) {
    if (buying) return;
    setBuying(true);
    setError(undefined);
    try {
      const session = await client.checkout(credits);
      if (onCheckout) await onCheckout(session.url);
      else window.location.assign(session.url);
    } catch (cause) {
      setError(cause);
    } finally {
      setBuying(false);
    }
  }
  if (capabilities.billing?.mode !== "credits")
    return (
      <section>
        <h1>Billing</h1>
        <p>Billing is unavailable on this server.</p>
      </section>
    );
  const balance = billing ? Number(billing.availableCredits ?? 0) : undefined;
  return (
    <section className="billing-page">
      {onBack && (
        <button className="text-button" onClick={onBack}>
          ← Back to your book
        </button>
      )}
      <div className="eyebrow">ACCOUNT</div>
      <h1>Credits & billing</h1>
      <ErrorMessage error={error} />
      {result === "success" && (
        <p role="status">
          Checkout complete. Your balance updates after payment confirmation. We
          will refresh it for one minute.
        </p>
      )}
      {result === "cancelled" && (
        <p role="status">Checkout cancelled. No new credits have been added.</p>
      )}
      <div className="balance-panel">
        <div>
          <span className="quiet">Available balance</span>
          <strong>
            {balance == null ? "Loading…" : balance.toLocaleString()}{" "}
            <span>credits</span>
          </strong>
          {balance != null && (
            <p>
              Available: {balance} credits (${(balance / 100).toFixed(2)}).
            </p>
          )}
        </div>
        <span className="balance-art" aria-hidden="true">
          ◈
        </span>
      </div>
      <button className="text-button" onClick={() => setRefresh((n) => n + 1)}>
        Refresh balance
      </button>
      <h2>Add credits</h2>
      <p className="muted">
        100 credits = $1 USD. Pay securely through Stripe.
      </p>
      {billing?.checkoutEnabled === "true" ? (
        <div className="credit-packs">
          {[500, 1000, 2000].map((credits) => (
            <button
              className="credit-pack"
              key={credits}
              disabled={buying}
              aria-label={`Buy ${credits.toLocaleString("en-US")} credits — $${credits / 100}`}
              onClick={() => void buy(credits)}
            >
              <strong>{credits.toLocaleString()}</strong>
              <span>credits</span>
              <b>${credits / 100}</b>
              <span className="accent">
                {buying ? "Opening checkout…" : "Continue to checkout →"}
              </span>
            </button>
          ))}
        </div>
      ) : (
        billing && <p>Card payments are not available yet.</p>
      )}
      <p className="quiet">
        Applicable tax is shown at checkout. Local-currency totals may vary; the
        credit amount stays the same.
      </p>
      <div className="billing-columns">
        <section>
          <h2>How credits work</h2>
          <ul className="pricing-rules">
            <li>
              The selected speech text and narration settings determine the
              estimate.
            </li>
            <li>
              The current full-cast rate includes a 50% premium for character
              analysis.
            </li>
            <li>Voice choice, title and cover do not add a surcharge.</li>
            <li>
              Catalog previews and recorded example scenes use no credits.
            </li>
            <li>
              Credits are reserved only when you start. Failed or cancelled
              conversions release the reservation.
            </li>
          </ul>
        </section>
        <section>
          <h2>Before you create</h2>
          <p className="muted">
            Your book’s estimate updates when settings change. The final price
            and available balance are checked again before starting.
          </p>
          <p className="quiet">
            Check the confirmed price at checkout before purchasing credits.
          </p>
        </section>
      </div>
    </section>
  );
}
