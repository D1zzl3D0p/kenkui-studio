import type { ChapterResponse } from "../api/generated/v1";
import type { Draft } from "./store";
import { chapterSummary, isLongChapter, narrationOf } from "./estimates";

export function ComposerChapters({ draft: d, update, narration, speechCharacters }: {
  draft: Draft; update(patch: Partial<Draft>): void;
  narration: ReturnType<typeof narrationOf>;
  speechCharacters(chapter: ChapterResponse): number | null | undefined;
}) { return (
                  <div className="chapter-selection">
                    <div className="section-top">
                      <span>
                        {d.chapters.length} of {d.book.chapters.length} chapters
                      </span>
                      <button
                        className="text-button"
                        onClick={() =>
                          update({ chapters: d.book.chapters.map((c) => c.id) })
                        }
                      >
                        Select all
                      </button>
                    </div>
                    {d.book.chapters.map((c) => (
                      <label className="checkbox chapter-row" key={c.id}>
                        <input
                          type="checkbox"
                          // The label now carries a size beside the title, so the
                          // control names itself rather than reading both out.
                          aria-label={c.title}
                          checked={d.chapters.includes(c.id)}
                          onChange={(e) =>
                            update({
                              chapters: e.target.checked
                                ? d.book.chapters
                                    .filter(
                                      (item) =>
                                        item.id === c.id ||
                                        d.chapters.includes(item.id),
                                    )
                                    .map((item) => item.id)
                                : d.chapters.filter((id) => id !== c.id),
                            })
                          }
                        />
                        <span className="chapter-name">{c.title}</span>
                        {chapterSummary(speechCharacters(c), narration) && (
                          <small
                            className={
                              isLongChapter(speechCharacters(c), narration)
                                ? "chapter-meta long"
                                : "chapter-meta"
                            }
                          >
                            {chapterSummary(speechCharacters(c), narration)}
                            {isLongChapter(speechCharacters(c), narration) &&
                              " · unusually long"}
                          </small>
                        )}
                      </label>
                    ))}
                  </div>
); }
