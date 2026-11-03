import type { BookResponse } from "../api/generated/v1";
export const defaultSpeechSettings = {
  chapterPauses: true,
  prepareNumbers: true,
  pronunciationCorrections: true,
  stutterHandling: false,
};
export type SpeechSettings = typeof defaultSpeechSettings;
/** What a new draft starts with. An existing draft keeps what it stored. */
export const defaultPauseLengths = {
  chapterPauseMs: "1500",
  scenePauseMs: "1000",
  headingBeforePauseMs: "0",
  headingAfterPauseMs: "0",
  paragraphPauseMs: "0",
  linePauseMs: "0",
};
export type PauseLengths = typeof defaultPauseLengths;
/** Which of these a server will actually apply. Absent means an older server. */
export type SettingsSupport = {
  speechSettings?: boolean;
  pauseLengths?: boolean;
  scenePauses?: boolean;
  spokenChapterTitles?: boolean;
};
/** Tiers this draft may send, in the order a reader meets them. */
export function pauseFieldsFor(support: SettingsSupport): (keyof PauseLengths)[] {
  const keys = Object.keys(defaultPauseLengths) as (keyof PauseLengths)[];
  return support.scenePauses ? keys : keys.filter((key) => key !== "scenePauseMs");
}
export function validPauseLength(value: string): boolean {
  return /^\d+$/.test(value.trim()) && Number(value) <= 60_000;
}
// A tier a draft never stored was never chosen for it, so it reads as off.
// Filling from the new-draft defaults would hand old work a pause it never
// asked for, and the draft would render differently than when it was saved.
const noPauses = Object.fromEntries(
  Object.keys(defaultPauseLengths).map((key) => [key, "0"]),
) as PauseLengths;
export function pauseLengthsFor(d: Pick<Draft, "pauseLengths" | "speechSettings">): PauseLengths {
  if (d.pauseLengths) return { ...noPauses, ...d.pauseLengths };
  return {
    ...noPauses,
    chapterPauseMs: d.speechSettings?.chapterPauses ? "1500" : "0",
  };
}
export type ChapterTitles = { enabled: boolean; pauseMs: string; overrides: { [chapterId: string]: string | null } };
export const defaultChapterTitles: ChapterTitles = { enabled: true, pauseMs: "750", overrides: {} };
export function chapterTitlesFor(d: Pick<Draft, "chapterTitles">): ChapterTitles {
  return d.chapterTitles ?? { enabled: false, pauseMs: "750", overrides: {} };
}
export type Draft = {
  chapterTitles?: ChapterTitles;
  pauseLengths?: PauseLengths;
  speechSettings?: SpeechSettings;
  id: string;
  book: BookResponse;
  originalSourceId: string;
  title: string;
  author: string;
  chapters: string[];
  narrator: string;
  mode: "single" | "characters";
  model: string;
  unknown: string;
  method: string;
  format: string;
  sourceCover: boolean;
  step: number;
  key: string;
  updated: number;
};
export type Record = {
  id: string;
  sourceId: string;
  title: string;
  author: string;
  narrator: string;
  sourceCover: boolean;
};
export type Library = { drafts: Draft[]; records: Record[] };
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `studio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
