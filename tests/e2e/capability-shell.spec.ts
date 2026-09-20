import { expect, test } from "@playwright/test";

test("uploads a cover, resumes a draft, and downloads a completed book", async ({
  page,
}) => {
  const errors: string[] = [];
  let submittedTts: unknown;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/jobs")
      submittedTts = request.postDataJSON().tts;
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto("/");
  await page
    .getByLabel("EPUB source")
    .setInputFiles("tests/fixtures/book.epub");
  await expect(
    page.getByRole("heading", { name: "Book details" }),
  ).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("My audiobook");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .getByLabel("Upload cover")
    .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
  await expect(
    page.getByRole("button", { name: "Restore original cover" }),
  ).toBeVisible();
  await expect(page.locator(".book-identity img")).toBeVisible();
  await page.getByRole("button", { name: "Kenkui Studio home" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "My audiobook — Draft, open actions" })
    .click();
  await page.getByRole("button", { name: "Continue setup" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "My audiobook",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Full cast/ }).click();
  await expect(page.getByText("Automatic character casting")).toBeVisible();
  await page.getByText("Pacing · 1500 ms between chapters", { exact: true }).click();
  await expect(page.getByLabel("Between chapters (ms)")).toHaveValue("1500");
  await page.getByLabel("Between chapters (ms)").fill("2200");
  await page.getByLabel("Between scenes (ms)").fill("900");
  await page.getByLabel("Before headings (ms)").fill("150");
  await page.getByLabel("After headings (ms)").fill("600");
  await page.getByLabel("Between paragraphs (ms)").fill("250");
  await page.getByLabel("Between lines (ms)").fill("100");
  await page.getByText("Speech preparation · 2 enabled", { exact: true }).click();
  await expect(page.getByLabel("Prepare numbers for narration")).toBeChecked();
  await expect(page.getByLabel("Use pronunciation corrections")).toBeChecked();
  await page.getByLabel("Improve stuttered dialogue").check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Create audiobook", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your audiobook is ready" }),
  ).toBeVisible();
  expect(submittedTts).toEqual({ normalizeText: true, chapterPauses: true, prepareNumbers: true, pronunciationCorrections: true, stutterHandling: true, chapterPauseMs: 2200, scenePauseMs: 900, headingBeforePauseMs: 150, headingAfterPauseMs: 600, paragraphPauseMs: 250, linePauseMs: 100 });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download M4B" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("My audiobook.m4b");
  await page.getByRole("button", { name: "Kenkui Studio home" }).click();
  await expect(
    page.getByRole("button", { name: "My audiobook — Ready, open actions" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile themes, exclusive voice auditions, and audio-driven waveform", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Appearance").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page
    .getByLabel("EPUB source")
    .setInputFiles("tests/fixtures/book.epub");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Change voice" }).click();
  await page.getByRole("button", { name: "Preview Beatrix" }).click();
  await expect(
    page.getByRole("button", { name: "Pause Beatrix" }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page
        .locator(".wave.speaking i")
        .evaluateAll((bars) =>
          bars.some(
            (bar) =>
              !["scaleY(0.16)", "scaleY(0.1)"].includes(
                (bar as HTMLElement).style.transform,
              ),
          ),
        ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Preview Anna" }).click();
  await expect(page.getByRole("button", { name: "Pause Anna" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview Beatrix" })).toBeVisible();
  await expect(page.getByText(/Reference recording/)).toBeVisible();
  await page.screenshot({ path: "test-results/mobile-voice-picker.png" });
  await page.getByRole("button", { name: "Use voice" }).click();
  await expect(
    page.getByRole("button", { name: "Preview Beatrix" }),
  ).toHaveCount(0);
  await page.getByLabel("Appearance").selectOption("dark");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review & create" })).toBeVisible();
  await expect(page.getByText("Hear the difference")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play example" })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-create-dark.png",
    fullPage: true,
  });
});
