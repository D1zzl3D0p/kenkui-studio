import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHost, downloadArtifact, hostCapabilitiesFor, nativeFetch, openEventChannel, subscribeToResume } from "../src/host/tauri";
import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import { load } from "@tauri-apps/plugin-store";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class { onmessage = (_frame: unknown) => {}; },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));

beforeEach(() => {
  vi.mocked(platform).mockReturnValue("macos");
  vi.mocked(load).mockResolvedValue({ get: vi.fn(), set: vi.fn(), save: vi.fn() } as never);
  vi.mocked(save).mockResolvedValue(null);

});

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
  it.each([204, 205, 304])("reconstructs a bodyless %s response", async (status) => {
    const invoke = vi.fn().mockResolvedValue({ status, headers: [], body: [] });
    const response = await nativeFetch(invoke, "https://api.test")("https://api.test/v1/jobs");
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
  });

  it("exposes Rust failures as fetch network errors", async () => {
    const invoke = vi.fn().mockRejectedValue("connection refused");
    await expect(nativeFetch(invoke, "https://api.test")("https://api.test/v1/jobs"))
      .rejects.toBeInstanceOf(TypeError);
  });
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

  it("sends no JS credentials and refuses requests outside the selected origin", async () => {
    const invoke = vi.fn().mockResolvedValue({ status: 200, headers: [], body: [] });
    const fetcher = nativeFetch(invoke, "https://api.test");

    await fetcher("https://api.test/v1/jobs");
    await expect(fetcher("http://192.168.1.20:7850/v1/jobs")).rejects.toThrow(/selected server/);

    const headersFor = (call: number) =>
      Object.fromEntries(invoke.mock.calls[call][1].spec.headers as [string, string][]);
    expect(headersFor(0).Authorization).toBeUndefined();
    expect(invoke).toHaveBeenCalledOnce();
  });
});

describe("native stream lifecycle", () => {
  it("forwards event and disconnect messages and cancels the Rust task", async () => {
    const invoke = vi.fn().mockResolvedValue(7);
    const stream = openEventChannel(invoke)("https://api.test/v1/jobs/job-1/events");
    const onFrame = vi.fn(), onError = vi.fn();
    stream.onFrame(onFrame);
    stream.onError(onError);
    await Promise.resolve();
    const channel = invoke.mock.calls[0][1].channel;
    channel.onmessage({ kind: "event", event: "progress", data: "{}" });
    expect(onFrame).toHaveBeenCalledWith({ type: "progress", data: "{}" });
    channel.onmessage({ kind: "error", message: "EOF" });
    expect(onError).toHaveBeenCalledOnce();
    stream.close();
    stream.close();
    expect(invoke).toHaveBeenCalledWith("kenkui_events_close", { id: 7 });
    expect(invoke).toHaveBeenCalledTimes(2);
    channel.onmessage({ kind: "error", message: "late" });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("cancels a stream closed before its ID arrives", async () => {
    let resolve!: (id: number) => void;
    const invoke = vi.fn().mockImplementationOnce(() => new Promise<number>((done) => { resolve = done; }))
      .mockResolvedValue(undefined);
    const stream = openEventChannel(invoke)("https://api.test/events");
    stream.close();
    expect(invoke).toHaveBeenCalledOnce();
    resolve(42);
    await Promise.resolve();
    expect(invoke).toHaveBeenLastCalledWith("kenkui_events_close", { id: 42 });
  });

  it("reports startup failures unless the stream was already closed", async () => {
    const invoke = vi.fn().mockRejectedValue("cannot connect");
    const stream = openEventChannel(invoke)("https://api.test/events");
    const error = vi.fn();
    stream.onError(error);
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
    const closed = openEventChannel(invoke)("https://api.test/events");
    closed.onError(error);
    closed.close();
    await Promise.resolve();
    await Promise.resolve();
    expect(error).toHaveBeenCalledOnce();
  });
});

describe("native export", () => {
  it("does not download an artifact when the save dialog is cancelled", async () => {
    const host = await createHost();
    const artifact = { url: "https://api.test/artifact", load: vi.fn() };
    await host.saveArtifact(artifact, "book.m4b");
    expect(save).toHaveBeenCalledWith({ defaultPath: "book.m4b" });
    expect(artifact.load).not.toHaveBeenCalled();

  });

  it("streams through Rust without loading artifact bytes into JavaScript", async () => {
    vi.mocked(save).mockResolvedValue("/chosen/book.m4b");
    vi.mocked(tauriInvoke).mockImplementationOnce(async (_command, args) => {
      (args as { channel: { onmessage(frame: unknown): void } }).channel.onmessage({ kind: "complete" });
      return 1 as never;
    });
    const host = await createHost();
    const artifact = { url: "https://api.test/artifact", load: vi.fn() };
    await host.saveArtifact(artifact, "book.m4b");
    expect(tauriInvoke).toHaveBeenCalledWith("kenkui_download_start", expect.objectContaining({ url: artifact.url, path: "/chosen/book.m4b" }));
    expect(artifact.load).not.toHaveBeenCalled();
  });

  it("forwards progress and waits for native cancellation even when abort precedes the ID", async () => {
    let resolve!: (id: number) => void;
    const invoke = vi.fn().mockImplementationOnce(() => new Promise<number>((done) => { resolve = done; }))
      .mockResolvedValue(undefined);
    const controller = new AbortController();
    const onProgress = vi.fn();
    const result = downloadArtifact(invoke, "https://api.test/artifact", "/book.m4b", { signal: controller.signal, onProgress });
    const channel = invoke.mock.calls[0][1].channel;
    channel.onmessage({ kind: "progress", received: 10, total: 100 });
    expect(onProgress).toHaveBeenCalledWith({ kind: "progress", received: 10, total: 100 });
    controller.abort();
    resolve(42);
    await Promise.resolve();
    expect(invoke).toHaveBeenLastCalledWith("kenkui_download_cancel", { id: 42 });
    channel.onmessage({ kind: "cancelled" });
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports native transfer failures", async () => {
    const invoke = vi.fn().mockResolvedValue(1);
    const result = downloadArtifact(invoke, "https://api.test/artifact", "/book.m4b");
    invoke.mock.calls[0][1].channel.onmessage({ kind: "error", message: "Disk full" });
    await expect(result).rejects.toThrow("Disk full");
  });

  it.each(["ios", "android"] as const)("downloads into the native share cache on %s", async (os) => {
    vi.mocked(platform).mockReturnValue(os);
    vi.mocked(tauriInvoke).mockImplementationOnce(async (_command, args) => {
      const channel = (args as { channel: { onmessage(frame: unknown): void } }).channel;
      channel.onmessage({ kind: "sharing" });
      channel.onmessage({ kind: "complete" });
      return 1 as never;
    });
    const host = await createHost();
    const artifact = { url: "https://api.test/artifact", load: vi.fn() };
    const onProgress = vi.fn();
    await host.saveArtifact(artifact, "book.m4b", { onProgress });
    expect(tauriInvoke).toHaveBeenCalledWith("kenkui_download_start", expect.objectContaining({ suggestedName: "book.m4b", path: undefined }));
    expect(onProgress).toHaveBeenCalledWith({ received: 0, phase: "sharing" });
    expect(artifact.load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

it("uses native mobile resume events and handles unsubscribe before registration", async () => {
  let complete!: (off: () => void) => void;
  vi.mocked(listen).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const wake = vi.fn(), off = vi.fn();
  const unsubscribe = subscribeToResume(wake, true);
  expect(listen).toHaveBeenCalledWith("kenkui:resume", expect.any(Function));
  const callback = vi.mocked(listen).mock.calls.at(-1)![1];
  callback({} as never);
  expect(wake).toHaveBeenCalledOnce();
  unsubscribe();
  complete(off);
  await Promise.resolve();
  expect(off).toHaveBeenCalledOnce();
  callback({} as never);
  expect(wake).toHaveBeenCalledOnce();
});
