import { describe, expect, it, vi } from "vitest";
import { createServerRegistry, serverOrigin, type RegistryStore } from "../src/host/native-registry";
import type { HostCapabilities } from "../src/host";

const desktop: HostCapabilities = { chooseServer: true, reachLoopback: true, saveToPath: true, manageLocalServer: false };
const mobile = { ...desktop, reachLoopback: false, saveToPath: false };
const cloud = "https://api.kenkui.test";

function setup(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  const save = vi.fn().mockResolvedValue(undefined);
  const store: RegistryStore = {
    get: async <T,>(key: string) => values.get(key) as T | undefined,
    set: async (key, value) => { values.set(key, value); },
    save,
  };
  const probe = vi.fn().mockImplementation(async () => new Response('{"apiVersion":"1"}'));
  return { registry: createServerRegistry(store, desktop, probe, cloud), probe, values, save };
}

describe("native server registry", () => {
  it("offers Cloud but starts without a selected server", async () => {
    const { registry } = setup();
    await expect(registry.selected()).resolves.toBeUndefined();
    await expect(registry.list()).resolves.toEqual([
      { id: "cloud", label: "Kenkui Cloud", baseUrl: cloud, kind: "cloud" },
    ]);
  });

  it("validates and durably saves a server and selection", async () => {
    const { registry, probe, save } = setup();
    const entry = await registry.add(" http://127.0.0.1:7850/ ", "Local");
    expect(probe).toHaveBeenCalledWith("http://127.0.0.1:7850/v1/capabilities");
    expect(save).toHaveBeenCalledTimes(1);
    await registry.select(entry.id);
    await expect(registry.selected()).resolves.toEqual(entry);
    expect(save).toHaveBeenCalledTimes(2);
    await registry.remove(entry.id);
    await expect(registry.selected()).resolves.toBeUndefined();
  });

  it.each([
    new Response("not json"),
    new Response('{"apiVersion":"99"}'),
    new Response("null"),
    new Response("unavailable", { status: 503 }),
  ])("does not persist incompatible or invalid probe responses", async (response) => {
    const { registry, probe, save } = setup();
    probe.mockResolvedValue(response);
    await expect(registry.add("https://wrong.test")).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
    expect(await registry.list()).toHaveLength(1);
  });

  it("repairs placeholder Cloud records and ignores corrupt entries", async () => {
    const { registry } = setup({
      entries: [null, { id: "cloud", kind: "cloud", baseUrl: "https://api.kenkui.example" },
        { id: "http://lan.test", kind: "custom", baseUrl: "http://lan.test", label: "LAN" },
        { id: "bad", kind: "custom", baseUrl: "file:///tmp", label: "Bad" }],
      selected: "cloud",
    });
    expect(await registry.list()).toHaveLength(2);
    await expect(registry.selected()).resolves.toMatchObject({ baseUrl: cloud });
    await expect(registry.select("unknown")).rejects.toThrow("Choose a server");
  });

  it("handles corrupt registry values and stale selections", async () => {
    const { registry } = setup({ entries: { broken: true }, selected: "deleted" });
    expect(await registry.list()).toHaveLength(1);
    await expect(registry.selected()).resolves.toBeUndefined();
  });

  it("waits for the settings write before allowing navigation", async () => {
    const { registry, save } = setup();
    let finish!: () => void;
    save.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const navigated = vi.fn();
    const selecting = registry.select("cloud").then(navigated);
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect(navigated).not.toHaveBeenCalled();
    finish();
    await selecting;
    expect(navigated).toHaveBeenCalledOnce();
  });
});

describe("server addresses", () => {
  it.each(["file:///tmp", "https://user:secret@example.com", "https://example.com/api", "https://example.com?x=1", "https://example.com/#x"])("rejects unsupported address %s", (address) => {
    expect(() => serverOrigin(address, desktop)).toThrow();
  });
  it.each(["http://localhost:7850", "http://127.1:7850", "http://127.0.0.2", "http://[::1]:7850", "http://app.localhost"])("rejects mobile loopback %s", (address) => {
    expect(() => serverOrigin(address, mobile)).toThrow(/loopback/);
  });
  it("allows LAN servers on mobile and loopback on desktop", () => {
    expect(serverOrigin("http://192.168.1.2:7850/", mobile)).toBe("http://192.168.1.2:7850");
    expect(serverOrigin("http://[::1]:7850/", desktop)).toBe("http://[::1]:7850");
  });
});
