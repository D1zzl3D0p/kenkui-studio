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
