import { expect, test } from "@playwright/test";

test("completes a server job from preflight through a terminal snapshot", async ({ page }) => {
  let snapshots = 0;
  await page.addInitScript(() => {
    class TestEventSource {
      private readonly listeners: Record<string, ((event: MessageEvent<string>) => void)[]> = {};
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor(_: string) {
        Object.defineProperty(window, "jobEventSource", { configurable: true, value: this, writable: true });
      }
      addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
        (this.listeners[type] ??= []).push(listener);
      }
      close() {}
      emit(type: string, payload: unknown) {
        for (const listener of this.listeners[type] ?? []) listener({ data: JSON.stringify(payload) } as MessageEvent<string>);
      }
    }
    window.EventSource = TestEventSource as unknown as typeof EventSource;
  });
  await page.route("**/v1/capabilities", async (route) => route.fulfill({ json: {
    apiVersion: "1", auth: { mode: "none" }, billing: { mode: "unmetered" }, casting: { mode: "single" }, outputFormats: ["m4b"], sourceFormats: ["epub"],
  } }));
  await page.route("**/v1/voices", async (route) => route.fulfill({ json: { items: [{ id: "voice-1", name: "Narrator", language: "en" }] } }));
  await page.route("**/v1/assets", async (route) => route.fulfill({ json: { id: "asset-1", format: "epub", sha256: "hash" } }));
  await page.route("**/v1/assets/asset-1/book", async (route) => route.fulfill({ json: { sourceId: "asset-1", title: "Book", author: "Author", chapters: [{ id: "chapter-1", title: "Chapter 1" }] } }));
  await page.route("**/v1/jobs/preflight", async (route) => route.fulfill({ json: { sourceId: "asset-1", normalizedCharacters: 42, valid: true } }));
  await page.route("**/v1/jobs", async (route) => route.fulfill({ status: 202, json: { id: "job-1", status: "queued", progress: { stage: "queued", completed: 0, total: 1 } } }));
  await page.route("**/v1/jobs/job-1", async (route) => {
    snapshots += 1;
    await route.fulfill({ json: { id: "job-1", status: snapshots === 1 ? "running" : "succeeded", progress: { stage: snapshots === 1 ? "synthesis" : "complete", completed: snapshots === 1 ? 1 : 2, total: 2 } } });
  });

  await page.goto("/jobs/new");
  await page.getByLabel("EPUB source").setInputFiles("tests/fixtures/book.epub");
  await page.getByRole("button", { name: "Inspect source" }).click();
  await page.getByRole("button", { name: "Continue to casting" }).click();
  await page.getByRole("button", { name: "Continue to synthesis" }).click();
  await page.getByRole("button", { name: "Continue to output" }).click();
  await page.getByRole("button", { name: "Review job" }).click();
  await expect(page.getByText("42 normalized characters")).toBeVisible();
  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByText("Status: running")).toBeVisible();

  await page.evaluate(() => {
    const source: unknown = Reflect.get(window, "jobEventSource");
    if (!source || typeof source !== "object" || !("emit" in source) || typeof source.emit !== "function") throw new Error("Job event source is unavailable.");
    source.emit("completed", { sequence: 2, type: "completed", progress: { stage: "complete", completed: 2, total: 2 } });
  });
  await expect(page.getByText("Status: succeeded")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download M4B" })).toBeVisible();
});
