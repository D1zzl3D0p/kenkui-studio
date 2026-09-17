import { useEffect, useState } from "react";
import type { BillingResponse, Capabilities, CreditHistoryResponse } from "../api/generated/v1";
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
  const [billing, setBilling] = useState<BillingResponse>(),
    [error, setError] = useState<unknown>();
  const [buying, setBuying] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [history, setHistory] = useState<CreditHistoryResponse>();
  const [historyError, setHistoryError] = useState(false);
  useEffect(() => {
    setHistory(undefined);
    setHistoryError(false);
  }, [client]);
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
            if (value.creditHistoryAvailable) {
              void client.creditHistory().then((result) => {
                if (active) {
                  setHistory(result);
                  setHistoryError(false);
                }
              }).catch(() => {
                if (active) setHistoryError(true);
              });
            }
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
  // Older servers offered these standard-rate packs before publishing a catalog.
  const packs = billing?.packs ?? [500, 1000, 2000].map((credits) => ({
    credits, priceUsdCents: credits,
  }));
  return (
    <section className="billing-page">
      {onBack && (
        <button className="text-button" onClick={onBack}>
          ← Back to your book
        </button>
      )}
      <h1>Credits</h1>
      <ErrorMessage error={error} />
      {result === "success" && (
        <p role="status">
          Checkout complete. Your balance updates after payment confirmation.
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
        </div>
        <button className="text-button" onClick={() => setRefresh((n) => n + 1)}>
          Refresh balance
        </button>
      </div>
      <h2>Add credits</h2>
      <p className="muted">
        One-time top-ups. No subscription.
      </p>
      {billing?.checkoutEnabled === "true" ? (
        <div className="credit-packs">
          {packs.map(({ credits, priceUsdCents }) => (
            <button
              className="credit-pack"
              key={credits}
              disabled={buying}
              aria-label={`Buy ${credits.toLocaleString("en-US")} credits — $${priceUsdCents / 100} USD`}
              onClick={() => void buy(credits)}
            >
              <strong>{credits.toLocaleString()}</strong>
              <span>credits</span>
              <b>${(priceUsdCents / 100).toFixed(2)} USD</b>
              {credits > priceUsdCents && (
                <span>
                  {(credits - priceUsdCents).toLocaleString()} bonus credits
                </span>
              )}
              <span className="accent">
                {buying ? "Opening checkout…" : "Buy credits →"}
              </span>
            </button>
          ))}
        </div>
      ) : (
        billing && <p>Card payments are not available yet.</p>
      )}
      <p className="quiet">Secure checkout with Stripe. Tax calculated at checkout.</p>
      <details className="billing-details">
        <summary>Pricing & refunds</summary>
        <p className="quiet">Standard rate: 100 credits per $1 USD. Credits pay for book conversion and are not a cash balance.</p>
        <ul className="pricing-rules">
          {packs.map(({ credits, priceUsdCents }) => (
            <li key={credits}>{credits.toLocaleString()} credits: ${(priceUsdCents / credits / 100).toFixed(4)} USD per credit{credits > priceUsdCents && ` · ${((1 - priceUsdCents / credits) * 100).toFixed(2)}% lower than the standard rate`}</li>
          ))}
        </ul>
      <p className="quiet">
        Applicable tax is shown at checkout. Local-currency totals may vary; the
        credit amount stays the same. Each pack is a one-time purchase, with no
        subscription or automatic renewal.
      </p>
      <p className="quiet">
        Fully unused packs are refundable on request within 14 days of purchase.
        Partly used packs are excluded from this voluntary offer; mandatory consumer
        rights still apply. Contact <a href="mailto:team@kenkui.fm">team@kenkui.fm</a>.
      </p>
      </details>
      <details className="billing-details">
          <summary>How credits work</summary>
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
          <h3>Before you create</h3>
          <p className="muted">
            Your book’s estimate updates when settings change. The final price
            and available balance are checked again before starting.
          </p>
          <p className="quiet">
            Check the confirmed price at checkout before purchasing credits.
          </p>
          <p className="quiet">
            Download completed audiobooks within 30 days. Uploaded sources become
            eligible for deletion 24 hours after all their conversions finish;
            unused uploads become eligible after 24 hours. Keep your original EPUB.
          </p>
      </details>
      {billing?.creditHistoryAvailable && (
        <details className="billing-details">
          <summary>Credit history</summary>
          <p className="quiet">
            Complimentary and legacy credits are used first, then purchased packs
            from oldest to newest. Reservations hold credits; only a successful
            conversion marks them used. Failed or cancelled conversions release
            credits back to the same packs.
          </p>
          {historyError ? <p role="status">Could not refresh credit history. Use Refresh balance to try again.</p>
            : !history ? <p role="status">Loading credit history…</p> : null}
          {history && history.items.length === 0 && <p>No credit history yet.</p>}
          <ul className="credit-history">
            {history?.items.map((lot) => (
              <li key={lot.id}>
                <strong>{lot.credited.toLocaleString()} credits · {lot.source === "purchase" ? "Purchased pack" : lot.source === "legacy" ? "Legacy balance" : "Complimentary credits"}</strong>
                <p>Available: {lot.available.toLocaleString()} · Reserved: {lot.reserved.toLocaleString()} · Used: {lot.consumed.toLocaleString()}</p>
                <p>{({ unused: "Unused pack", reserved: "Awaiting conversion outcome", used: "Pack has been used", manual_review: "Earlier usage unknown — manual review required", not_purchased: "Not a purchased pack" })[lot.usageStatus]}</p>
                <p className="quiet">Recorded {new Date(lot.recordedAt).toLocaleString()} · Reference: {lot.reference}</p>
              </li>
            ))}
          </ul>
          <p className="quiet">
            Unused status is not a refund approval: the 14-day period is measured
            from purchase, not the date credits were recorded here. Email
            {" "}<a href="mailto:team@kenkui.fm">team@kenkui.fm</a> with the pack reference.
            Legacy balances cannot establish whether an earlier pack was unused.
          </p>
        </details>
      )}
      <p className="quiet">
        <a href="https://kenkui.fm/terms/">Terms & conditions</a>{" · "}
        <a href="https://kenkui.fm/privacy/">Privacy</a>{" · "}
        <a href="https://kenkui.fm/refunds/">Refunds & delivery</a>{" · "}
        <a href="https://kenkui.fm/contact/">Support</a>
      </p>
    </section>
  );
}
