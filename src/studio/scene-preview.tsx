import { useState } from "react";
import { useAudioPlayer, Wave } from "./audio-player";
export function ScenePreview({ fullCast }: { fullCast: boolean }) {
  const [mode, setMode] = useState(fullCast ? "cast" : "single");
  const audio = useAudioPlayer();
  const url = (value: string) =>
    `/audio/samples/${value === "cast" ? "full-cast" : "narrator"}.wav`;
  return (
    <section className="scene-preview" aria-label="Example narration preview">
      <div className="section-top">
        <h3>Hear the difference</h3>
        <span className="free-badge">Free · 0 credits</span>
      </div>
      <div className="scene-modes" role="group" aria-label="Example narration">
        {[
          ["single", "Single narrator"],
          ["cast", "Full cast"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              if (audio.playing) audio.switchClip(value, url(value));
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        className="preview-wide"
        aria-label={audio.playing ? "Pause example" : "Play example"}
        onClick={() => audio.toggle(mode, url(mode))}
      >
        <span className="play-circle">{audio.playing ? "Ⅱ" : "▶"}</span>
        <span>{audio.playing ? "Playing example" : "Play example"}</span>
        <Wave active={Boolean(audio.playing)} analyser={audio.analyser} />
      </button>
      <p className="quiet">
        <cite>Pride and Prejudice</cite> · Recorded example, not a preview of
        your text or selected voices.
      </p>
      {audio.error && <p role="alert">{audio.error}</p>}
    </section>
  );
}
