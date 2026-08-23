import type { VoiceResponse } from "../api/generated/v1";

/** What the wizard collects here. Absent fields mean single-voice casting. */
export interface CastingValue {
  narratorVoiceId?: string;
  unknownVoiceId?: string;
  method?: string;
  modelId?: string;
}

interface CastingProps {
  modes: string[];
  voices: VoiceResponse[];
  value: CastingValue;
  onChange(value: CastingValue): void;
}

const METHODS = [
  { id: "gendered", label: "Match voice to character gender" },
  { id: "random", label: "Any available voice" },
];

/**
 * Casting controls, shown only for what this server actually supports.
 *
 * Per-character overrides are deliberately absent: the character roster does
 * not exist until attribution runs on the server, and preflight is
 * contractually free of jobs and reservations, so there is nothing to list
 * yet. The resolved cast arrives on the job's event stream instead.
 */
export function Casting({ modes, voices, value, onChange }: CastingProps) {
  if (!modes.includes("characters")) {
    return <p>This server supports one narrator per job.</p>;
  }
  const set = (patch: CastingValue) => onChange({ ...value, ...patch });
  return (
    <fieldset>
      <legend>Casting</legend>

      <label htmlFor="narrator">Narrator</label>
      <select
        id="narrator"
        value={value.narratorVoiceId ?? ""}
        onChange={(event) => set({ narratorVoiceId: event.target.value })}
      >
        <option value="">Choose a voice</option>
        {voices.map((voice) => (
          <option key={voice.id} value={voice.id}>
            {voice.name}
          </option>
        ))}
      </select>

      <label htmlFor="unknown">Unknown speaker</label>
      <select
        id="unknown"
        value={value.unknownVoiceId ?? ""}
        onChange={(event) => set({ unknownVoiceId: event.target.value })}
      >
        {/* Empty means follow the narrator, so a line nobody could place
            sounds like narration rather than like a separate character. */}
        <option value="">Same as narrator</option>
        {voices.map((voice) => (
          <option key={voice.id} value={voice.id}>
            {voice.name}
          </option>
        ))}
      </select>

      <label htmlFor="method">Casting method</label>
      <select
        id="method"
        value={value.method ?? "gendered"}
        onChange={(event) => set({ method: event.target.value })}
      >
        {METHODS.map((method) => (
          <option key={method.id} value={method.id}>
            {method.label}
          </option>
        ))}
      </select>

      <label htmlFor="model">Attribution model</label>
      <input
        id="model"
        type="text"
        value={value.modelId ?? ""}
        placeholder="model this server allows"
        onChange={(event) => set({ modelId: event.target.value })}
      />
    </fieldset>
  );
}
