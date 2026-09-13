import { describe, expect, it, vi } from "vitest";
import { hostCapabilitiesFor, nativeFetch } from "../src/host/tauri";

describe("native host capabilities", () => {
  it("lets a desktop reach a local server and write files", () => {
    expect(hostCapabilitiesFor("macos")).toEqual({
      chooseServer: true, reachLoopback: true, manageLocalServer: false, saveToPath: true,
    });
  });

  it("denies loopback and path saving on mobile", () => {
    expect(hostCapabilitiesFor("ios")).toEqual({
      chooseServer: true, reachLoopback: false, manageLocalServer: false, saveToPath: false,
    });
  });
});

describe("native fetch", () => {
  it("sends the request through Rust and rebuilds a Response", async () => {
    const invoke = vi.fn().mockResolvedValue({
      status: 200,
      headers: [["content-type", "application/json"]],
      body: Array.from(new TextEncoder().encode('{"apiVersion":"1"}')),
    });

    const response = await nativeFetch(invoke, "https://api.test")("https://api.test/v1/capabilities");

    expect(await response.json()).toEqual({ apiVersion: "1" });
    expect(invoke).toHaveBeenCalledWith("kenkui_request", expect.objectContaining({
      spec: expect.objectContaining({ url: "https://api.test/v1/capabilities", method: "GET" }),
    }));
  });

  it("attaches the token only to the selected server's origin", async () => {
    const invoke = vi.fn().mockResolvedValue({ status: 200, headers: [], body: [] });
    const fetcher = nativeFetch(invoke, "https://api.test", "secret-token");

    await fetcher("https://api.test/v1/jobs");
    await fetcher("http://192.168.1.20:7850/v1/jobs");

    const headersFor = (call: number) =>
      Object.fromEntries(invoke.mock.calls[call][1].spec.headers as [string, string][]);
    expect(headersFor(0).Authorization).toBe("Bearer secret-token");
    expect(headersFor(1).Authorization).toBeUndefined();
  });
});
