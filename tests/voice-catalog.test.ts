import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { voiceInfo } from "../src/studio/voice-picker";
import catalog from "../src/studio/voice-catalog.json";
import hosted from "./fixtures/hosted-voices.json";

describe("hosted voice previews", () => {
  it("resolves the short IDs returned by the hosted API and the existing long IDs", () => {
    expect(voiceInfo("beatrix")).toBe(voiceInfo("beatrix-f-vctk-p233-english"));
    for (const voice of hosted) expect(voiceInfo(voice.id)?.name).toBe(voice.name);
    expect(voiceInfo("beatrix-custom")).toBeUndefined();
    expect(voiceInfo("unknown")).toBeUndefined();
  });
  it("ships playable WAV files for every catalog entry, including reference recordings", () => {
    for (const voice of catalog) {
      const bytes = readFileSync(`public${voice.audio}`);
      expect(bytes.subarray(0, 4).toString(), voice.id).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString(), voice.id).toBe("WAVE");
      expect(bytes.length, voice.id).toBeGreaterThan(44);
    }
    expect(voiceInfo("anna")?.previewKind).toBe("reference");
    expect(voiceInfo("beatrix")?.previewKind).toBe("synthesized");
  });
});
