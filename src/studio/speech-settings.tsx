import { validPauseLength, type PauseLengths, type SpeechSettings } from "./store";

// Drafts created before these options existed retain their original behavior.
export const legacySpeechSettings: SpeechSettings = {
  chapterPauses: false,
  prepareNumbers: false,
  pronunciationCorrections: false,
  stutterHandling: false,
};

const preparation = [
  ["prepareNumbers", "Prepare numbers for narration", "Prepares common numbers, amounts, and units for speech without guessing dates or Roman numerals."],
  ["pronunciationCorrections", "Use pronunciation corrections", "Applies Kenkui’s built-in pronunciation dictionary."],
  ["stutterHandling", "Improve stuttered dialogue", "Helps read words such as S-s-sorry. May also change spellings such as D-day or S-shaped."],
] as const;

export function SpeechControls({ value = legacySpeechSettings, onChange, showChapterToggle = true }: {
  showChapterToggle?: boolean;
  value?: SpeechSettings;
  onChange(value: SpeechSettings): void;
}) {
  return <>
    {showChapterToggle && <details data-settings-id="chapter-pauses">
      <summary>Pacing · Chapter pauses {value.chapterPauses ? "on" : "off"}</summary>
      <div className="settings-grid">
        <label className="checkbox">
          <input type="checkbox" checked={value.chapterPauses}
            aria-describedby="chapter-pauses-description"
            onChange={(event) => onChange({ ...value, chapterPauses: event.target.checked })} />
          Pause between chapters
        </label>
        <p className="quiet" id="chapter-pauses-description">Adds a 1.5-second gap between chapters, with no extra silence at the end of the book.</p>
      </div>
    </details>}
    <details data-settings-id="speech">
      <summary>Speech preparation · {preparation.filter(([key]) => value[key]).length} enabled</summary>
      <p className="quiet">These options apply to English narration. Other narrator languages use the original text preparation.</p>
      <div className="settings-grid">
        {preparation.map(([key, label, description]) => <div key={key}>
          <label className="checkbox">
            <input type="checkbox" checked={value[key]} aria-describedby={`${key}-description`}
              onChange={(event) => onChange({ ...value, [key]: event.target.checked })} />
            {label}
          </label>
          <p className="quiet" id={`${key}-description`}>{description}</p>
        </div>)}
      </div>
    </details>
  </>;
}

export function SpeechReview({ value = legacySpeechSettings, showChapterToggle = true }: { value?: SpeechSettings; showChapterToggle?: boolean }) {
  return <dl className="review" aria-label="Pacing and speech preparation">
    {showChapterToggle && <div><dt>Chapter pauses</dt><dd>{value.chapterPauses ? "1.5 seconds" : "Off"}</dd></div>}
    {preparation.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value[key] ? "On (English narration)" : "Off"}</dd></div>)}
  </dl>;
}


const pauseFields = [
  ["chapterPauseMs", "Between chapters"],
  ["headingBeforePauseMs", "Before headings"],
  ["headingAfterPauseMs", "After headings"],
  ["paragraphPauseMs", "Between paragraphs"],
  ["linePauseMs", "Between lines"],
] as const;

export function PauseControls({ value, onChange }: {
  value: PauseLengths;
  onChange(value: PauseLengths): void;
}) {
  const invalid = pauseFields.some(([key]) => !validPauseLength(value[key]));
  return <details data-settings-id="pause-lengths">
    <summary>Pacing · {invalid ? "Check pause lengths" : `${Number(value.chapterPauseMs)} ms between chapters`}</summary>
    <p className="quiet" id="pause-lengths-help">
      Enter whole milliseconds from 0 to 60,000. Use 0 for no added pause.
      When boundaries overlap, the longest pause applies. No extra silence is added at the end of the book.
    </p>
    <div className="settings-grid">
      {pauseFields.map(([key, label]) => {
        const valid = validPauseLength(value[key]);
        return <div key={key}>
          <label>
            {label} (ms)
            <input
              type="text"
              inputMode="numeric"
              value={value[key]}
              aria-invalid={!valid}
              aria-describedby={`pause-lengths-help${valid ? "" : ` ${key}-error`}`}
              onChange={(event) => onChange({ ...value, [key]: event.target.value })}
            />
          </label>
          {!valid && <p className="quiet" id={`${key}-error`} role="alert">
            Enter a whole number from 0 to 60,000.
          </p>}
        </div>;
      })}
    </div>
  </details>;
}

export function PauseReview({ value }: { value: PauseLengths }) {
  return <dl className="review" aria-label="Pause lengths">
    {pauseFields.map(([key, label]) => <div key={key}>
      <dt>{label}</dt><dd>{Number(value[key]) === 0 ? "Off" : `${Number(value[key])} ms`}</dd>
    </div>)}
  </dl>;
}
