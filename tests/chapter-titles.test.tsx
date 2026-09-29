import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ChapterTitleControls } from "../src/studio/chapter-titles";
import { chapterTitlesFor, defaultChapterTitles, readLibrary, requestFor, type Draft } from "../src/studio/store";

const draft: Draft = {
  id: "draft", book: { sourceId: "source", title: "Dune", author: "Herbert", chapters: [{ id: "c1", title: "Chapter 1" }] },
  originalSourceId: "source", title: "Dune", author: "Herbert", chapters: ["c1"], narrator: "voice", mode: "single",
  model: "", unknown: "", method: "gendered", format: "m4b", sourceCover: true, step: 2, key: "key", updated: 0,
};

test("new defaults announce titles and legacy drafts explicitly opt out", () => {
  expect(defaultChapterTitles.enabled).toBe(true);
  expect(chapterTitlesFor(draft).enabled).toBe(false);
  expect(requestFor(draft).tts?.speakChapterTitles).toBe(false);
  const request = requestFor({ ...draft, chapterTitles: { ...defaultChapterTitles, overrides: { c1: "Chapter one", other: "Excluded chapter" } } });
  expect(request.tts).toMatchObject({ speakChapterTitles: true, chapterTitlePauseMs: 750, chapterTitleOverrides: { c1: "Chapter one" } });
  expect(requestFor(draft, {}).tts).not.toHaveProperty("speakChapterTitles");
});

test("announcement settings persist with the draft", () => {
  const configured = { ...draft, chapterTitles: { enabled: true, pauseMs: "300", overrides: { c1: null } } };
  localStorage.setItem("titles-test", JSON.stringify({ drafts: [configured], records: [] }));
  expect(readLibrary("titles-test").drafts[0].chapterTitles).toEqual(configured.chapterTitles);
});

test("controls allow opt-out, overrides and per-chapter exclusion", () => {
  const onChange = vi.fn();
  render(<ChapterTitleControls value={defaultChapterTitles} chapters={draft.book.chapters} supported onChange={onChange}
    preview={[{ chapterId: "c1", text: "Chapter 1", kind: "inserted" }]} />);
  expect(screen.getByLabelText("Speak chapter titles")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Speak chapter titles"));
  expect(onChange).toHaveBeenLastCalledWith({ ...defaultChapterTitles, enabled: false });
  fireEvent.change(screen.getByLabelText("Spoken title for Chapter 1"), { target: { value: "Chapter one" } });
  expect(onChange).toHaveBeenLastCalledWith({ ...defaultChapterTitles, overrides: { c1: "Chapter one" } });
  fireEvent.click(screen.getByLabelText("Announce Chapter 1"));
  expect(onChange).toHaveBeenLastCalledWith({ ...defaultChapterTitles, overrides: { c1: null } });
});
