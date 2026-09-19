import type { Capabilities, ChapterResponse } from "../api/generated/v1";
import { chapterSummary, isLongChapter, narrationOf } from "../studio/estimates";

interface ChapterSelectionProps { chapters: ChapterResponse[]; selected: string[]; onChange(ids: string[]): void; capabilities?: Capabilities }

export function ChapterSelection({ chapters, selected, onChange, capabilities }: ChapterSelectionProps) {
  const narration = narrationOf(capabilities);
  return <fieldset><legend>Chapters</legend>{chapters.map((chapter) => <label key={chapter.id}><input type="checkbox" aria-label={chapter.title} checked={selected.includes(chapter.id)} onChange={(event) => onChange(event.target.checked ? [...selected, chapter.id] : selected.filter((id) => id !== chapter.id))} />{chapter.title}{chapterSummary(chapter.speechCharacters, narration) && <small className={isLongChapter(chapter.speechCharacters, narration) ? "chapter-meta long" : "chapter-meta"}> {chapterSummary(chapter.speechCharacters, narration)}{isLongChapter(chapter.speechCharacters, narration) && " · unusually long"}</small>}</label>)}</fieldset>;
}
