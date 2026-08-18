interface TtsSettingsProps { normalizeText: boolean; onChange(value: boolean): void }

export function TtsSettings({ normalizeText, onChange }: TtsSettingsProps) {
  return <label><input type="checkbox" checked={normalizeText} onChange={(event) => onChange(event.target.checked)} />Normalize text</label>;
}
