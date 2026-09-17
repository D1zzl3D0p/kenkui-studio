import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BillingPage } from "../src/pages/billing";
import type { KenkuiServerClient } from "../src/api/client";
import type { Capabilities } from "../src/api/generated/v1";

const capabilities = { billing: { mode: "credits" } } as Capabilities;

it("offers dollar-priced packs and recovers from checkout failure", async () => {
  const client = {
    billing: vi.fn().mockResolvedValue({ availableCredits: "300", checkoutEnabled: "true" }),
    checkout: vi.fn().mockRejectedValue(new Error("Payment service unavailable")),
  };
  render(<BillingPage client={client as unknown as KenkuiServerClient} capabilities={capabilities} />);
  const buy = await screen.findByRole("button", { name: "Buy 500 credits — $5 USD" });
  expect(screen.getByText("300")).toBeInTheDocument();
  fireEvent.click(buy);
  await waitFor(() => expect(client.checkout).toHaveBeenCalledWith(500));
  await waitFor(() => expect(buy).toBeEnabled());
  expect(screen.getByRole("alert")).toBeInTheDocument();
});

it("uses the server pack price independently of the number of credits", async () => {
  const client = {
    billing: vi.fn().mockResolvedValue({ availableCredits: "0", checkoutEnabled: "true",
      packs: [{ credits: 1100, priceUsdCents: 1000 }] }),
    checkout: vi.fn().mockResolvedValue({ url: "https://checkout.stripe.com/test" }),
  };
  const onCheckout = vi.fn().mockResolvedValue(undefined);
  render(<BillingPage client={client as unknown as KenkuiServerClient} capabilities={capabilities} onCheckout={onCheckout} />);
  const buy = await screen.findByRole("button", { name: "Buy 1,100 credits — $10 USD" });
  expect(screen.getByText("100 bonus credits")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Pricing & refunds"));
  expect(screen.getByText(/\$0.0091 USD per credit/)).toBeInTheDocument();
  fireEvent.click(buy);
  await waitFor(() => expect(client.checkout).toHaveBeenCalledWith(1100));
  await waitFor(() => expect(onCheckout).toHaveBeenCalledWith("https://checkout.stripe.com/test"));
});

it("does not offer checkout when the server has no payment configuration", async () => {
  const client = { billing: vi.fn().mockResolvedValue({ availableCredits: "0", checkoutEnabled: "false" }) };
  render(<BillingPage client={client as unknown as KenkuiServerClient} capabilities={capabilities} />);
  await waitFor(() => expect(client.billing).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: /Buy/ })).not.toBeInTheDocument();
});

it("refreshes a successful checkout for at most one minute", async () => {
  vi.useFakeTimers();
  window.history.replaceState({}, "", "/billing?checkout=success");
  const client = { billing: vi.fn().mockResolvedValue({ availableCredits: "500", checkoutEnabled: "false" }) };
  const view = render(<BillingPage client={client as never} capabilities={capabilities} />);
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText(/Checkout complete/)).toBeInTheDocument();
    client.billing.mockResolvedValue({ availableCredits: "1000", checkoutEnabled: "false" });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText("1,000")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(57000); });
    const calls = client.billing.mock.calls.length;
    expect(calls).toBeGreaterThan(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(client.billing).toHaveBeenCalledTimes(calls);
  } finally {
    view.unmount();
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
  }
});

it("shows cancelled checkout without polling or adding credits", async () => {
  vi.useFakeTimers();
  window.history.replaceState({}, "", "/billing?checkout=cancelled");
  const client = { billing: vi.fn().mockResolvedValue({ availableCredits: "300", checkoutEnabled: "false" }) };
  const view = render(<BillingPage client={client as never} capabilities={capabilities} />);
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(screen.getByText(/Checkout cancelled/)).toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument();
    expect(client.billing).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
  }
});

it("recovers credit history independently of the available balance", async () => {
  const client = {
    billing: vi.fn().mockResolvedValue({ availableCredits: "300", checkoutEnabled: "true", creditHistoryAvailable: true }),
    creditHistory: vi.fn().mockRejectedValueOnce(new Error("Temporary history failure")).mockResolvedValue({ items: [{
      id: "pack-1", credited: 500, available: 300, reserved: 100, consumed: 100,
      source: "purchase", usageStatus: "used", recordedAt: "2026-09-16T00:00:00Z", reference: "purchase-1",
    }] }),
  };
  render(<BillingPage client={client as never} capabilities={capabilities} />);
  await screen.findByText(/Could not refresh credit history/);
  expect(screen.getByText("300")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Buy 500 credits — $5 USD" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh balance" }));
  await screen.findByText("500 credits · Purchased pack");
  expect(screen.getByText("Available: 300 · Reserved: 100 · Used: 100")).toBeInTheDocument();
  expect(screen.getByText("Pack has been used")).toBeInTheDocument();
  expect(screen.queryByText(/Could not refresh credit history/)).not.toBeInTheDocument();
});

it("shows pack usage without treating unused status as refund approval", async () => {
  const client = {
    billing: vi.fn().mockResolvedValue({ availableCredits: "480", checkoutEnabled: "false", creditHistoryAvailable: true }),
    creditHistory: vi.fn().mockResolvedValue({ items: [
      { id: "pack", source: "purchase", reference: "stripe:cs_one", credited: 500,
        available: 480, reserved: 20, consumed: 0, recordedAt: "2026-09-16T00:00:00Z", usageStatus: "reserved" },
      { id: "old", source: "legacy", reference: "legacy:one", credited: 10,
        available: 0, reserved: 0, consumed: 10, recordedAt: "2026-09-16T00:00:00Z", usageStatus: "manual_review" },
    ] }),
  };
  render(<BillingPage client={client as unknown as KenkuiServerClient} capabilities={capabilities} />);
  expect(await screen.findByText("Awaiting conversion outcome")).toBeInTheDocument();
  expect(screen.getByText(/Earlier usage unknown/)).toBeInTheDocument();
  expect(screen.getByText(/Available: 480 · Reserved: 20 · Used: 0/)).toBeInTheDocument();
  expect(screen.getByText(/Unused status is not a refund approval/)).toBeInTheDocument();
});

it("keeps billing usable when purchase history fails and can retry", async () => {
  const client = {
    billing: vi.fn().mockResolvedValue({ availableCredits: "500", checkoutEnabled: "true", creditHistoryAvailable: true }),
    creditHistory: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ items: [] }),
  };
  render(<BillingPage client={client as unknown as KenkuiServerClient} capabilities={capabilities} />);
  expect(await screen.findByText(/Could not refresh credit history/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Buy 500 credits — $5 USD" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh balance" }));
  expect(await screen.findByText("No credit history yet.")).toBeInTheDocument();
  expect(screen.queryByText(/Could not refresh credit history/)).not.toBeInTheDocument();
});

it("keeps billing details collapsed until requested", async () => {
  const client = { billing: vi.fn().mockResolvedValue({ availableCredits: "300", checkoutEnabled: "true", creditHistoryAvailable: true }),
    creditHistory: vi.fn().mockResolvedValue({ items: [] }) };
  render(<BillingPage client={client as never} capabilities={capabilities} />);
  expect(await screen.findByRole("button", { name: "Buy 500 credits — $5 USD" })).toBeVisible();
  for (const label of ["Pricing & refunds", "How credits work", "Credit history"]) {
    const summary = screen.getByText(label);
    expect(summary.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
  }
});
