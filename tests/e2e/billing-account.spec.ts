import { expect, test } from "@playwright/test";
import { patchCapabilities } from "./capabilities";

test("mobile billing shows pack details, refreshes history, and opens checkout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await patchCapabilities(page, { auth: { mode: "session" }, billing: { mode: "credits" } });
  await page.route("**/v1/auth/session", (route) => route.fulfill({ json: { userId: "billing-reader" } }));
  let balance = "300";
  await page.route("**/v1/billing", (route) => route.fulfill({ json: {
    availableCredits: balance, checkoutEnabled: "true", creditHistoryAvailable: true,
    packs: [{ credits: 1100, priceUsdCents: 1000 }],
  } }));
  await page.route("**/v1/billing/history", (route) => route.fulfill({ json: { items: [{
    id: "pack-1", credited: 1100, available: 300, reserved: 0, consumed: 800,
    source: "purchase", usageStatus: "used", recordedAt: "2026-09-16T00:00:00Z", reference: "purchase-1",
  }] } }));
  let checkoutCredits: number | undefined;
  await page.route("**/v1/billing/checkout", (route) => {
    checkoutCredits = route.request().postDataJSON().credits;
    return route.fulfill({ json: { url: "http://127.0.0.1:4173/test-checkout" } });
  });
  await page.route("**/test-checkout", (route) => route.fulfill({
    contentType: "text/html", body: "<h1>Checkout destination</h1>",
  }));
  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Credits", exact: true })).toBeVisible();
  const buy = page.getByRole("button", { name: "Buy 1,100 credits — $10 USD" });
  await expect(buy).toBeVisible();
  await expect(page.getByText("100 bonus credits", { exact: true })).toBeVisible();
  for (const label of ["Pricing & refunds", "How credits work", "Credit history"]) {
    const summary = page.locator("summary", { hasText: label });
    await expect(summary.locator("..")).not.toHaveAttribute("open");
    await summary.click();
    await expect(summary.locator("..")).toHaveAttribute("open");
  }
  await expect(page.getByText(/\$0.0091 USD per credit/)).toBeVisible();
  await expect(page.getByText("Pack has been used", { exact: true })).toBeVisible();
  balance = "500";
  await page.getByRole("button", { name: "Refresh balance" }).click();
  await expect(page.locator(".balance-panel strong")).toHaveText("500 credits");

  const account = page.getByRole("button", { name: "Account", exact: true });
  await account.click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.locator(".account-popover form")).toHaveAttribute("method", "post");
  await page.keyboard.press("Escape");
  await expect(account).toBeFocused();
  await expect(account).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/mobile-billing.png", fullPage: true });
  await buy.click();
  await expect(page.getByRole("heading", { name: "Checkout destination" })).toBeVisible();
  expect(checkoutCredits).toBe(1100);
});
