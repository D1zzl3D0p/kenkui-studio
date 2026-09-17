import { useEffect, useRef, useState } from "react";
import type { VoiceResponse } from "../api/generated/v1";
import catalog from "./voice-catalog.json";
import { useAudioPlayer, Wave } from "./audio-player";
export const voiceInfo = (id: string) => catalog.find((v) => v.id === id || v.serverId === id);
export function VoicePicker({
  voices,
  selected,
  role,
  onSelect,
  onClose,
}: {
  voices: VoiceResponse[];
  selected: string;
  role: string;
  onSelect(id: string): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(""),
    [accent, setAccent] = useState("All accents"),
    [choice, setChoice] = useState(selected);
  const audio = useAudioPlayer();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const available = voices.filter((v) => {
    const info = voiceInfo(v.id);
    return (
      `${v.name} ${info?.accent ?? ""} ${v.language ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (accent === "All accents" || info?.accent === accent)
    );
  });
  return (
    <dialog
      className="voice-dialog"
      ref={ref}
      aria-labelledby="voice-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-top">
        <h2 id="voice-title">Find your voice</h2>
        <button
          className="icon-button"
          aria-label="Close voice picker"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="muted">For {role} · Catalog previews are free.</p>
      <div className="voice-filters">
        <input
          aria-label="Search voices"
          autoFocus
          placeholder="Search by name or accent"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Filter by accent"
          value={accent}
          onChange={(e) => setAccent(e.target.value)}
        >
          <option>All accents</option>
          {[
            ...new Set(
              voices.map((v) => voiceInfo(v.id)?.accent).filter(Boolean),
            ),
          ]
            .sort()
            .map((a) => (
              <option key={a}>{a}</option>
            ))}
        </select>
      </div>
      <div className="voice-list">
        {available.map((v) => {
          const info = voiceInfo(v.id);
          return (
            <div
              key={v.id}
              className={`voice-row ${choice === v.id ? "chosen" : ""}`}
            >
              <button
                className="audition"
                disabled={!info}
                aria-label={`${audio.playing === v.id ? "Pause" : "Preview"} ${v.name}`}
                title={
                  info ? (info.previewKind === "reference" ? "Play reference recording" : "Play voice preview") : "No catalog preview available"
                }
                onClick={() => info && audio.toggle(v.id, info.audio)}
              >
                {audio.playing === v.id ? "Ⅱ" : "▶"}
              </button>
              <button
                className="voice-choice"
                aria-pressed={choice === v.id}
                onClick={() => setChoice(v.id)}
              >
                <strong>{v.name}</strong>
                <span>
                  {info
                    ? `${info.accent} · ${info.gender}${info.previewKind === "reference" ? " · Reference recording" : ""}`
                    : v.language || "Voice"}
                </span>
              </button>
              {audio.playing === v.id ? (
                <Wave active analyser={audio.analyser} />
              ) : (
                <span className="selection-dot" aria-hidden="true">
                  {choice === v.id ? "✓" : ""}
                </span>
              )}
            </div>
          );
        })}
        {!available.length && (
          <p>No matching voices. Try another name or accent.</p>
        )}
      </div>
      {audio.error && <p role="alert">{audio.error}</p>}
      <div className="dialog-footer">
        <span className="quiet">
          {voices.find((v) => v.id === choice)?.name || "Choose a voice"}
        </span>
        <button
          className="primary"
          disabled={!voices.some((v) => v.id === choice)}
          onClick={() => onSelect(choice)}
        >
          Use voice
        </button>
      </div>
      <p className="voice-attribution quiet">
        VCTK samples derived from the{" "}
        <a
          href="https://datashare.ed.ac.uk/handle/10283/3443"
          target="_blank"
          rel="noreferrer"
        >
          CSTR VCTK Corpus
        </a>{" "}
        via Kyutai/Kenkui, under{" "}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noreferrer"
        >
          CC BY 4.0
        </a>
        . Recordings were processed for speech synthesis.
      </p>
    </dialog>
  );
}
