import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("dropping an EPUB opens its draft and settings remain open when revisited", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto("/");
  const bytes = [...readFileSync("tests/fixtures/book.epub")];
  const transfer = await page.evaluateHandle((bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], "book.epub", { type: "application/epub+zip" }));
    return data;
  }, bytes);
  await page.locator(".drop-zone").dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(page.locator(".drop-zone")).toHaveClass(/dragging/);
  await page.locator(".drop-zone").dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByRole("heading", { name: "Book details" })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const pacing = page.locator("details").filter({ has: page.locator("summary", { hasText: "Pacing" }) });
  await pacing.locator("summary").click();
  await page.getByLabel("Between chapters (ms)").fill("2200");
  await expect(pacing).toHaveAttribute("open");
  expect(await page.getByLabel("Between chapters (ms)").evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(34);
  // Record explicit scroll-to-top calls separately from normal viewport clamping.
  await page.evaluate(() => {
    (window as any).scrollCalls = [];
    const original = window.scrollTo.bind(window);
    window.scrollTo = ((...args: any[]) => { (window as any).scrollCalls.push(args); (original as any)(...args); }) as typeof window.scrollTo;
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(pacing).toHaveAttribute("open");
  await expect(page.getByLabel("Between chapters (ms)")).toHaveValue("2200");
  expect(await page.evaluate(() => (window as any).scrollCalls)).toEqual([]);
  await page.screenshot({ path: "test-results/settings-navigation.png", fullPage: true });
  await transfer.dispose();
});

test("expired sessions replace the whole studio and sign-in goes directly to AuthKit", async ({ page }) => {
  await page.route("**/v1/capabilities", async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), auth: { mode: "session" }, billing: { mode: "credits" } } });
  });
  await page.route("**/v1/auth/session", route => route.fulfill({ json: { userId: "reader" } }));
  await page.route("**/v1/billing", route => route.fulfill({ json: { availableCredits: "500", checkoutEnabled: "true" } }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Choose file" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Billing", exact: true })).toContainText("500");
  await page.route("**/v1/billing", route => route.fulfill({ status: 401, json: { error: { code: "unauthenticated", message: "Sign in to continue.", requestId: "test-request" } } }));
  await page.getByRole("button", { name: "Billing", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to your studio" })).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose file" })).toHaveCount(0);
  await expect(page.getByText(/test-request/)).toHaveCount(0);
  await expect(page).toHaveURL("/");
  await page.route("**/v1/auth/login", route => route.fulfill({ contentType: "text/html", body: "<h1>AuthKit destination</h1>" }));
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AuthKit destination" })).toBeVisible();
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "AuthKit destination" })).toBeVisible();
});
