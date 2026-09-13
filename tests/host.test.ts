import { describe, expect, it, vi } from "vitest";
import { createHost } from "../src/host/web";

describe("web host", () => {
  it("reports browser capabilities", async () => {
    const host = await createHost();

    expect(host.platform).toBe("web");
    expect(host.can).toEqual({
      chooseServer: false,
      reachLoopback: true,
      manageLocalServer: false,
      saveToPath: false,
    });
  });

  it("uses the serving origin as its only server", async () => {
    const host = await createHost();

    await expect(host.servers.list()).resolves.toEqual([
      { id: "origin", label: "This server", baseUrl: "", kind: "origin" },
    ]);
    await expect(host.servers.selected()).resolves.toMatchObject({ baseUrl: "" });
  });

  it("uses the build's API origin when the SPA is served apart from the API", async () => {
    vi.stubEnv("VITE_KENKUI_API_ORIGIN", "https://api.kenkui.test");
    try {
      const host = await createHost();

      await expect(host.servers.selected()).resolves.toMatchObject({ baseUrl: "https://api.kenkui.test" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("downloads an artifact by URL so the browser streams it instead of buffering a Blob", async () => {
    const navigate = vi.fn();
    const host = await createHost({ navigate });
    const load = vi.fn();

    await host.saveArtifact({ url: "https://api.kenkui.test/v1/jobs/job-1/artifact", load }, "job-1.m4b");

    expect(navigate).toHaveBeenCalledWith("https://api.kenkui.test/v1/jobs/job-1/artifact");
    expect(load).not.toHaveBeenCalled();
  });

  it("refuses to add servers, because the hosted SPA offers no server chooser", async () => {
    const host = await createHost();

    await expect(host.servers.add("http://127.0.0.1:7850")).rejects.toThrow(/does not support/i);
  });

  it("returns the browser's own fetch and EventSource as its transport", async () => {
    const host = await createHost();

    expect(host.transport("")).toEqual({});
  });

  it("reports a resume when the document becomes visible again", async () => {
    const host = await createHost();
    const listener = vi.fn();
    const unsubscribe = host.onResume(listener);

    document.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
