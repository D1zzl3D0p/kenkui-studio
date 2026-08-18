import type { ChapterResponse } from "../api/generated/v1";

interface ChapterSelectionProps { chapters: ChapterResponse[]; selected: string[]; onChange(ids: string[]): void }

export function ChapterSelection({ chapters, selected, onChange }: ChapterSelectionProps) {
  return <fieldset><legend>Chapters</legend>{chapters.map((chapter) => <label key={chapter.id}><input type="checkbox" checked={selected.includes(chapter.id)} onChange={(event) => onChange(event.target.checked ? [...selected, chapter.id] : selected.filter((id) => id !== chapter.id))} />{chapter.title}</label>)}</fieldset>;
}
