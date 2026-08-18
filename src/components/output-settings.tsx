interface OutputSettingsProps { formats: string[]; format: string; onChange(format: string): void }

export function OutputSettings({ formats, format, onChange }: OutputSettingsProps) {
  return <label>Output<select value={format} onChange={(event) => onChange(event.target.value)}>{formats.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>;
}
