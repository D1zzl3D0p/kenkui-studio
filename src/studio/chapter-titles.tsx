import type { ChapterResponse, PreflightResponse } from "../api/generated/v1";
import { validPauseLength, type ChapterTitles } from "./store";

type Preview = PreflightResponse["chapterAnnouncements"];

export function ChapterTitleControls({ value, chapters, supported, preview, onChange }: {
  value: ChapterTitles;
  chapters: ChapterResponse[];
  supported: boolean;
  preview?: Preview;
  onChange(value: ChapterTitles): void;
}) {
  function override(id: string, text: string | null | undefined) {
    const overrides = { ...value.overrides };
    if (text === undefined) delete overrides[id];
    else overrides[id] = text;
    onChange({ ...value, overrides });
  }
  return <details data-settings-id="chapter-titles">
    <summary>Spoken chapter titles · {value.enabled ? "On" : "Off"}</summary>
    <label className="checkbox"><input type="checkbox" checked={value.enabled}
      onChange={event => onChange({ ...value, enabled: event.target.checked })} />Speak chapter titles</label>
    <p className="quiet">The narrator announces chapter titles before the chapter text. Matching opening headings are read once. Turn this off to narrate only the book’s text.</p>
    {!supported && <p role="alert">This server does not support spoken chapter titles. Turn this setting off or connect to a server that supports it.</p>}
    {value.enabled && supported && <>
      <label>Pause after chapter title (ms)<input type="text" inputMode="numeric"
        value={value.pauseMs} aria-invalid={!validPauseLength(value.pauseMs)}
        onChange={event => onChange({ ...value, pauseMs: event.target.value })} /></label>
      {!validPauseLength(value.pauseMs) && <p role="alert">Enter a whole number from 0 to 60,000.</p>}
      <p className="quiet">The existing chapter pause comes before the announcement. Overlapping automatic pauses use the longest duration.</p>
      <details><summary>Review and edit announcements</summary>
        <p className="quiet">Leave the text blank to use the book’s title. Unnamed sections are skipped unless you enter a title. Changes here affect spoken words only.</p>
        {chapters.map(chapter => {
          const decision = preview?.find(item => item.chapterId === chapter.id);
          const excluded = value.overrides[chapter.id] === null;
          return <div className="settings-grid" key={chapter.id}>
            <label className="checkbox"><input type="checkbox" checked={!excluded}
              onChange={event => override(chapter.id, event.target.checked ? undefined : null)} />Announce {chapter.title}</label>
            <label>Spoken title for {chapter.title}<input type="text" maxLength={500}
              disabled={excluded} placeholder={chapter.title} value={value.overrides[chapter.id] ?? ""}
              onChange={event => override(chapter.id, event.target.value.trim() ? event.target.value : undefined)} /></label>
            {decision && <p className="quiet">{decision.kind === "omitted" ? "No added announcement" : `${decision.kind === "existing" ? "Already in opening heading" : "Will announce"}: ${decision.text}`}</p>}
          </div>;
        })}
      </details>
    </>}
  </details>;
}

export function ChapterTitleReview({ enabled, pauseMs, preview }: { enabled: boolean; pauseMs: string; preview?: Preview }) {
  return <div>
    <p>Spoken chapter titles: {enabled ? `On · ${pauseMs} ms after titles` : "Off"}</p>
    {enabled && preview && <details><summary>Chapter announcements</summary><ul>
      {preview.map(item => <li key={item.chapterId}>{item.kind === "omitted" ? "No added announcement" : item.text}{item.kind === "existing" ? " (opening heading)" : ""}</li>)}
    </ul></details>}
  </div>;
}
