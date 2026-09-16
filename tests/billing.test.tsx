import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const buy = await screen.findByRole("button", { name: "Buy 500 credits — $5" });
  expect(screen.getByText("Available: 300 credits ($3.00).")).toBeInTheDocument();
  fireEvent.click(buy);
  await waitFor(() => expect(client.checkout).toHaveBeenCalledWith(500));
  await waitFor(() => expect(buy).toBeEnabled());
  expect(screen.getByRole("alert")).toBeInTheDocument();
});

it("does not offer checkout when the server has no payment configuration", async () => {
  const client = { billing: vi.fn().mockResolvedValue({ availableCredits: "0", checkoutEnabled: "false" }) };
  render(<BillingPage client={client as unknown as KenkuiServerClient} capabilities={capabilities} />);
  await waitFor(() => expect(client.billing).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: /Buy/ })).not.toBeInTheDocument();
});
