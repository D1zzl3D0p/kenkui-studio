import type { VoiceResponse } from "../api/generated/v1";

interface VoiceSelectProps { voices: VoiceResponse[]; selected?: string; onChange(id: string): void }

export function VoiceSelect({ voices, selected, onChange }: VoiceSelectProps) {
  return <fieldset><legend>Voice</legend>{voices.map((voice) => <label key={voice.id}><input type="radio" name="voice" checked={voice.id === selected} onChange={() => onChange(voice.id)} />{voice.name}{voice.language ? ` (${voice.language})` : ""}</label>)}</fieldset>;
}
