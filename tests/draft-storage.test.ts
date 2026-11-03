import { beforeEach, expect, it } from "vitest";
import { changeDraft, readLibrary, requestFor, saveLibrary, type Draft } from "../src/studio/store";

const draft: Draft = {
  id: "draft", book: { sourceId: "source", chapters: [{ id: "one", title: "One" }] } as Draft["book"],
  originalSourceId: "source", title: "Book", author: "Author", chapters: ["one"],
  narrator: "voice", mode: "single", model: "", unknown: "", method: "gendered", format: "m4b",
  sourceCover: true, step: 1, key: "admission", updated: 0,
};
beforeEach(() => localStorage.clear());

it("isolates a corrupt entry without discarding valid saved work", () => {
  localStorage.setItem("library", JSON.stringify({ drafts: [{ ...draft, book: { ...draft.book, chapters: [null] } }, draft], records: [] }));
  expect(readLibrary("library").drafts.map(d => d.id)).toEqual(["draft"]);
});

it("preserves the effective request and key of legacy drafts through a versioned save", () => {
  localStorage.setItem("library", JSON.stringify({ drafts: [draft], records: [] }));
  const library = readLibrary("library");
  expect(requestFor(library.drafts[0]).tts).toEqual({ normalizeText: true, speakChapterTitles: false, chapterTitlePauseMs: 750, chapterTitleOverrides: {} });
  expect(changeDraft(library.drafts[0], { title: " Book " }).key).toBe("admission");
  expect(changeDraft(library.drafts[0], { title: "Changed" }).key).not.toBe("admission");
  saveLibrary("library", library);
  expect(JSON.parse(localStorage.getItem("library")!).version).toBe(1);
  expect(readLibrary("library")).toEqual(library);
});

it("retains explicit false and zero settings", () => {
  const saved = { ...draft, chapterTitles: { enabled: false, pauseMs: "0", overrides: {} }, pauseLengths: { chapterPauseMs: "0" }, speechSettings: { chapterPauses: false, prepareNumbers: false, pronunciationCorrections: false, stutterHandling: false } };
  localStorage.setItem("library", JSON.stringify({ drafts: [saved], records: [] }));
  expect(requestFor(readLibrary("library").drafts[0]).tts).toMatchObject({ chapterPauseMs: 0, chapterTitlePauseMs: 0, prepareNumbers: false });
});

it("does not overwrite a future envelope or swallow storage write failures", () => {
  localStorage.setItem("library", JSON.stringify({ version: 2, drafts: [draft], records: [] }));
  expect(() => saveLibrary("library", { drafts: [], records: [] })).toThrow(/newer/);
  expect(JSON.parse(localStorage.getItem("library")!).version).toBe(2);
  const storage = { getItem: () => null, setItem: () => { throw new Error("Quota"); } };
  expect(() => saveLibrary("other", { drafts: [], records: [] }, storage)).toThrow("Quota");
});
