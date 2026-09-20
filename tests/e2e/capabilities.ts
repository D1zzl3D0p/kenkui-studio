import type { Page } from "@playwright/test";

/**
 * Serve the server's own capability document with some fields replaced.
 *
 * A capability request can still be in flight when a test ends: the page is
 * closing and nobody is waiting for the answer. Fetching or fulfilling then
 * rejects with "Test ended", which Playwright reports as an error belonging
 * to no test — failing a run whose tests all passed. There is no longer
 * anyone to serve, so stop quietly instead.
 */
export async function patchCapabilities(
  page: Page,
  patch: Record<string, unknown>,
): Promise<void> {
  await page.route("**/v1/capabilities", async (route) => {
    try {
      const response = await route.fetch();
      await route.fulfill({ json: { ...(await response.json()), ...patch } });
    } catch {
      return;
    }
  });
}
