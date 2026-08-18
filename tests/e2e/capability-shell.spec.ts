import { expect, test } from "@playwright/test";

test("loads capability-gated creation UI without hostname assumptions", async ({ page }) => {
  await page.route("**/v1/capabilities", async (route) => route.fulfill({ json: {
    apiVersion: "1", auth: { mode: "none" }, billing: { mode: "unmetered" }, casting: { mode: "single" }, outputFormats: ["m4b"], sourceFormats: ["epub"],
  } }));
  await page.route("**/v1/voices", async (route) => route.fulfill({ json: { items: [] } }));

  await page.goto("/jobs/new");

  await expect(page.getByRole("heading", { name: "Source" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inspect source" })).toBeVisible();
});
