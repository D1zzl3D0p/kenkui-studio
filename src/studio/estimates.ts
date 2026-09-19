import type { Capabilities } from "../api/generated/v1";

/** How this server's renderer turns text into time. */
export interface Narration {
  charactersPerSecond: number;
  longChapterHours: number;
}

/** Used only against a server too old to publish its own numbers. */
export const defaultNarration: Narration = {
  charactersPerSecond: 13,
  longChapterHours: 6,
};

export function narrationOf(capabilities?: Capabilities): Narration {
  const published = capabilities?.narration;
  return {
    charactersPerSecond:
      published?.charactersPerSecond ?? defaultNarration.charactersPerSecond,
    longChapterHours:
      published?.longChapterHours ?? defaultNarration.longChapterHours,
  };
}

export function estimatedHours(characters: number, narration: Narration): number {
  return characters / narration.charactersPerSecond / 3600;
}

export function isLongChapter(
  characters: number | null | undefined,
  narration: Narration,
): boolean {
  return (
    typeof characters === "number" &&
    estimatedHours(characters, narration) >= narration.longChapterHours
  );
}

/** Round to whole minutes: the estimate is not precise enough to imply seconds. */
export function formatDuration(hours: number): string {
  const minutes = Math.round(hours * 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} m`;
}

/**
 * Describe one chapter's size, or nothing when the server did not count it.
 * A server that omits the count is older than this field, not broken.
 */
export function chapterSummary(
  characters: number | null | undefined,
  narration: Narration,
): string | undefined {
  if (typeof characters !== "number") return undefined;
  return `${characters.toLocaleString()} characters · about ${formatDuration(
    estimatedHours(characters, narration),
  )}`;
}
