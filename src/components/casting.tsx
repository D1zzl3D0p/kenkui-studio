interface CastingProps { mode: string }

export function Casting({ mode }: CastingProps) {
  return <p>{mode === "single" ? "This server supports one narrator per job." : `Casting mode: ${mode}`}</p>;
}
