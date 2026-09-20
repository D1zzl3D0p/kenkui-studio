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

describe("web notifications", () => {
  class FakeNotification {
    static permission = "granted";
    static requestPermission = vi.fn().mockResolvedValue("granted");
    static shown: { title: string; options?: NotificationOptions }[] = [];
    static last: FakeNotification | undefined;
    onclick: (() => void) | null = null;
    constructor(title: string, options?: NotificationOptions) {
      FakeNotification.shown.push({ title, options });
      FakeNotification.last = this;
    }
  }

  type Navigate = ReturnType<typeof vi.fn<(url: string) => void>>;

  const withNotification = async (permission: string, run: (navigate: Navigate) => Promise<void> | void) => {
    FakeNotification.permission = permission;
    FakeNotification.shown = [];
    vi.stubGlobal("Notification", FakeNotification);
    const navigate = vi.fn<(url: string) => void>();
    try {
      await run(navigate);
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it("is absent where the browser has no notification API", async () => {
    vi.stubGlobal("Notification", undefined);
    try {
      expect((await createHost()).notifications).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows a notice that opens the book it announces", async () => {
    await withNotification("granted", async (navigate) => {
      const host = await createHost({ navigate });
      await host.notifications?.show({ title: "Ready", body: "Done", path: "/jobs/a" });

      expect(FakeNotification.shown).toEqual([
        { title: "Ready", options: { body: "Done", tag: "/jobs/a" } },
      ]);

      // Activating the notice must take the reader to the book it announced.
      FakeNotification.last?.onclick?.();
      expect(navigate).toHaveBeenCalledWith("/jobs/a");
    });
  });

  it("stays silent until permission is granted", async () => {
    await withNotification("default", async (navigate) => {
      const host = await createHost({ navigate });
      await expect(host.notifications?.permission()).resolves.toBe("default");
      await host.notifications?.show({ title: "Ready", body: "Done" });
      expect(FakeNotification.shown).toEqual([]);
    });
  });

  it("asks the browser when the reader opts in", async () => {
    await withNotification("default", async () => {
      const host = await createHost();
      await expect(host.notifications?.request()).resolves.toBe("granted");
      expect(FakeNotification.requestPermission).toHaveBeenCalled();
    });
  });
});
