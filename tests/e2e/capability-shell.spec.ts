import { expect, test } from "@playwright/test";

test("completes an EPUB job through the mounted local server", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(`${request.method()} ${new URL(request.url()).pathname}`));

  await page.goto("/jobs/new");
  await page.getByLabel("EPUB source").setInputFiles("tests/fixtures/book.epub");
  await page.getByRole("button", { name: "Inspect source" }).click();
  await expect(page.getByRole("heading", { name: "Chapters" })).toBeVisible();
  await expect(page.getByLabel("Fixture chapter")).toBeChecked();
  await page.getByRole("button", { name: "Continue to casting" }).click();
  await page.getByRole("button", { name: "Continue to synthesis" }).click();
  await page.getByRole("button", { name: "Continue to output" }).click();
  await page.getByRole("button", { name: "Review job" }).click();
  await expect(page.getByText(/\d+ normalized characters/)).toBeVisible();

  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByText("Status: succeeded")).toBeVisible();
  await expect.poll(() => requests.filter((entry) => /^GET \/v1\/jobs\/[^/]+$/.test(entry)).length).toBeGreaterThanOrEqual(2);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download M4B" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.m4b$/);

  expect(requests).toEqual(expect.arrayContaining([
    "POST /v1/assets",
    expect.stringMatching(/^GET \/v1\/assets\/[^/]+\/book$/),
    "POST /v1/jobs/preflight",
    "POST /v1/jobs",
    expect.stringMatching(/^GET \/v1\/jobs\/[^/]+\/events$/),
    expect.stringMatching(/^GET \/v1\/jobs\/[^/]+\/artifact$/),
  ]));
});
