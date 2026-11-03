import type { Page } from "@playwright/test";

const localOrigin = "http://127.0.0.1:4173";
export const studioOrigin = "https://studio.example.test";
export const syntheticAuthority = {apiOrigin:studioOrigin,resource:studioOrigin,issuer:"https://auth.example.test/db/auth",
  jwksUrl:"https://auth.example.test/db/auth/jwks",clientId:"synthetic-client"};

/** Exercise the scoped HTTPS transport using local fixtures for every origin. */
export async function mockManagedStudio(page: Page) {
  await page.route(studioOrigin + "/**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({response: await route.fetch({url: localOrigin + url.pathname + url.search})});
  });
  await page.route("**/v1/auth/native/config", route => route.fulfill({json:{
    protocolVersion:2, ...syntheticAuthority,
  }}));
  await page.route("https://auth.example.test/**", route => {
    const headers = {"access-control-allow-origin":studioOrigin, "access-control-allow-credentials":"true",
      "access-control-allow-headers": route.request().headers()["access-control-request-headers"] ?? "content-type",
      "access-control-allow-methods":"GET, POST, OPTIONS","access-control-expose-headers":"set-auth-jwt"};
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "OPTIONS") return route.fulfill({status:204,headers});
    if (path.endsWith("/get-session")) return route.fulfill({headers:{...headers,"set-auth-jwt":"synthetic.browser.jwt"},json:{session:{id:"test"},user:{id:"reader"}}});
    if (path.endsWith("/token")) return route.fulfill({headers,json:{token:"synthetic.browser.jwt"}});
    return route.fulfill({headers,json:{redirect:false}});
  });
}

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
      const response = await route.fetch({url:localOrigin + "/v1/capabilities"});
      await route.fulfill({ json: { ...(await response.json()), ...patch } });
    } catch {
      return;
    }
  });
}
