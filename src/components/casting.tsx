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
  models?: string[];
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
export function Casting({ modes, models = [], voices, value, onChange }: CastingProps) {
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
      <select
        id="model"
        value={value.modelId ?? models[0] ?? ""}
        onChange={(event) => set({ modelId: event.target.value })}
      >
        {models.map((model) => (
          <option key={model} value={model}>{model}</option>
        ))}
      </select>

      {voices.some((voice) =>
        voice.licenseId === "CC-BY-4.0" && voice.voiceRights?.includes("VCTK"),
      ) && (
        <p>
          These voices are derived from the{" "}
          <a href="https://datashare.ed.ac.uk/handle/10283/3443">CSTR VCTK Corpus</a>,
          licensed under{" "}
          <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
          The source recordings were modified by Kyutai and Kenkui into enhanced
          samples and speaker embeddings.
        </p>
      )}
    </fieldset>
  );
}
