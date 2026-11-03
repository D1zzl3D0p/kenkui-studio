import { defaultSpeechSettings, chapterTitlesFor, pauseLengthsFor, type SpeechSettings, type Draft, type Library, type Record } from "./draft-model";

export function readLibrary(key: string): Library {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "null");
    if (!raw || (raw.version !== undefined && raw.version !== 1) || !Array.isArray(raw.drafts) || !Array.isArray(raw.records))
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
          (d.chapterTitles === undefined ||
            (d.chapterTitles !== null && typeof d.chapterTitles.enabled === "boolean" &&
             typeof d.chapterTitles.pauseMs === "string" && d.chapterTitles.overrides !== null &&
             typeof d.chapterTitles.overrides === "object" && !Array.isArray(d.chapterTitles.overrides) &&
             Object.values(d.chapterTitles.overrides).every(v => v === null || typeof v === "string"))) &&
          (d.pauseLengths === undefined ||
            (typeof d.pauseLengths === "object" && d.pauseLengths !== null &&
              Object.values(d.pauseLengths).every(
                (value) => typeof value === "string",
              ))) &&
          (d.speechSettings === undefined ||
            (d.speechSettings !== null &&
              Object.keys(defaultSpeechSettings).every(
                (key) => typeof d.speechSettings?.[key as keyof SpeechSettings] === "boolean",
              ))) &&
          [1, 2, 3].includes(d.step) &&
          d.book.chapters.every(
            (c) => c && typeof c.id === "string" && typeof c.title === "string",
          ) &&
          d.chapters.every((c) => typeof c === "string") &&
          ["single", "characters"].includes(d.mode),
      ).map((d: Draft) => ({ ...d, chapterTitles: chapterTitlesFor(d), ...(d.pauseLengths ? { pauseLengths: pauseLengthsFor(d) } : {}) })),
      records: raw.records.filter(
        (r: Record) =>
          r && typeof r.id === "string" && typeof r.title === "string",
      ),
    };
  } catch {
    return { drafts: [], records: [] };
  }
}

/** Save at the same account-scoped key; never overwrite a newer client's format. */
export function saveLibrary(key: string, library: Library, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): void {
  const previous = storage.getItem(key);
  let version: unknown;
  try { version = previous ? JSON.parse(previous)?.version : undefined; } catch { /* corrupt old data can be replaced */ }
  if (version !== undefined && version !== 1) throw new Error("This library was saved by a newer version of Studio.");
  storage.setItem(key, JSON.stringify({ version: 1, ...library }));
}
