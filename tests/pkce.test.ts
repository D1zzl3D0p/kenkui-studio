import { describe, expect, it } from "vitest";
import { challengeFrom, randomVerifier } from "../src/host/pkce";

describe("pkce", () => {
  it("produces a verifier within the RFC 7636 length bounds", () => {
    const verifier = randomVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("derives the documented S256 challenge for the RFC example verifier", async () => {
    await expect(challengeFrom("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
      .resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
