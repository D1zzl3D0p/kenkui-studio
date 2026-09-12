import { describe, expect, it } from "vitest";
import { isSupportedApiVersion, supportedApiVersions } from "../src/host/version";

describe("api version compatibility", () => {
  it("accepts the version this build speaks", () => {
    expect(supportedApiVersions).toContain("1");
    expect(isSupportedApiVersion({ apiVersion: "1" })).toBe(true);
  });

  it("rejects a newer server this build predates", () => {
    expect(isSupportedApiVersion({ apiVersion: "2" })).toBe(false);
  });
});
