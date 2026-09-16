import type { BookResponse, JobRequest } from "../api/generated/v1";
export type Draft = {
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
export function requestFor(d: Draft): JobRequest {
  return {
    sourceId: d.book.sourceId,
    chapters: d.chapters,
    casting:
      d.mode === "single"
        ? { voiceId: d.narrator }
        : {
            narratorVoiceId: d.narrator,
            unknownVoiceId: d.unknown || d.narrator,
            method: d.method,
            modelId: d.model,
          },
    tts: { normalizeText: true },
    output: {
      format: d.format,
      title: d.title.trim() || null,
      author: d.author.trim() || null,
      sourceCover: d.sourceCover,
    },
  };
}
export function changeDraft(d: Draft, patch: Partial<Draft>): Draft {
  const next = { ...d, ...patch, updated: Date.now() };
  if (JSON.stringify(requestFor(d)) !== JSON.stringify(requestFor(next)))
    next.key = uid();
  return next;
}
export function readLibrary(key: string): Library {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "null");
    if (!raw || !Array.isArray(raw.drafts) || !Array.isArray(raw.records))
      return { drafts: [], records: [] };
    return {
      drafts: raw.drafts.filter(
        (d: Draft) =>
          d &&
          typeof d.id === "string" &&
          typeof d.book?.sourceId === "string" &&
          Array.isArray(d.book.chapters) &&
          Array.isArray(d.chapters) &&
          typeof d.key === "string" &&
          typeof d.title === "string" &&
          typeof d.author === "string" &&
          typeof d.narrator === "string" &&
          typeof d.format === "string" &&
          typeof d.model === "string" &&
          typeof d.method === "string" &&
          typeof d.unknown === "string" &&
          typeof d.originalSourceId === "string" &&
          [1, 2, 3].includes(d.step) &&
          d.book.chapters.every(
            (c) => c && typeof c.id === "string" && typeof c.title === "string",
          ) &&
          d.chapters.every((c) => typeof c === "string") &&
          ["single", "characters"].includes(d.mode),
      ),
      records: raw.records.filter(
        (r: Record) =>
          r && typeof r.id === "string" && typeof r.title === "string",
      ),
    };
  } catch {
    return { drafts: [], records: [] };
  }
}
