import type { Capabilities } from "../api/generated/v1";
import type { Draft } from "./store";

export function ComposerOutput({ draft: d, update, capabilities: cap }: {
  draft: Draft; update(patch: Partial<Draft>): void; capabilities: Capabilities;
}) { return <>
                {(cap.outputFormats?.length ?? 0) > 1 && (
                  <details data-settings-id="output">
                    <summary>Advanced</summary>
                    <label>
                      Audio format
                      <select
                        value={d.format}
                        onChange={(e) => update({ format: e.target.value })}
                      >
                        {cap.outputFormats?.map((f) => (
                          <option key={f} value={f}>
                            {f.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </label>
                  </details>
                )}
</>; }
