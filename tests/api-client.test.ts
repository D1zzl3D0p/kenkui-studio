import { describe, expect, it, vi } from "vitest";
import { KenkuiServerClient } from "../src/api/client";

const capabilities = {
  apiVersion: "1",
  auth: { mode: "none" },
  billing: { mode: "unmetered" },
  casting: { mode: "single" },
  outputFormats: ["m4b"],
  sourceFormats: ["epub"],
} as const;

describe("KenkuiServerClient", () => {
  it("uses one idempotency key for retried job submissions", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network reset"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "job-1", status: "queued", progress: { stage: "queued", completed: 0, total: 1 },
      }), { status: 202 }));
    const client = new KenkuiServerClient("http://server.test", { fetch: fetcher });

    await client.createJob({ sourceId: "asset-1", chapters: ["chapter-1"], casting: { voiceId: "voice-1" }, tts: { normalizeText: true }, output: { format: "m4b" } }, "same-key");

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map((call) => new Headers(call[1]?.headers).get("Idempotency-Key"))).toEqual(["same-key", "same-key"]);
  });

  it("refetches the Job snapshot after SSE reconnect", async () => {
    const getJob = vi.fn().mockResolvedValue({ id: "job-1", status: "running", progress: { stage: "synthesis", completed: 1, total: 2 } });
    const client = new KenkuiServerClient("http://server.test", { getJob, eventSource: FakeEventSource });
    const stream = client.events("job-1");

    await stream.onDisconnect();

    expect(getJob).toHaveBeenCalledWith("job-1");
  });

  it("loads capabilities without relying on the server hostname", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(capabilities)));
    const client = new KenkuiServerClient("https://example.invalid", { fetch: fetcher });

    await expect(client.capabilities()).resolves.toEqual(capabilities);
    expect(fetcher).toHaveBeenCalledWith("https://example.invalid/v1/capabilities", expect.any(Object));
  });
  it("delivers the server's completed and cancellation-requested events", () => {
    const onEvent = vi.fn();
    const client = new KenkuiServerClient("http://server.test", { getJob: vi.fn().mockResolvedValue({ id: "job-1", status: "running", progress: { stage: "synthesis", completed: 1, total: 2 } }), eventSource: FakeEventSource });
    client.events("job-1", onEvent);

    FakeEventSource.last.emit("completed", { sequence: 1, type: "completed", progress: { stage: "complete", completed: 2, total: 2 } });
    FakeEventSource.last.emit("cancel_requested", { sequence: 2, type: "cancel_requested", progress: { stage: "cancelling", completed: 1, total: 2 } });

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "completed" }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "cancel_requested" }));
  });
  it("refreshes and closes the stream after a terminal server event", async () => {
    const getJob = vi.fn().mockResolvedValue({ id: "job-1", status: "succeeded", progress: { stage: "complete", completed: 2, total: 2 } });
    const onSnapshot = vi.fn();
    const client = new KenkuiServerClient("http://server.test", { getJob, eventSource: FakeEventSource });
    client.events("job-1", undefined, onSnapshot);

    FakeEventSource.last.emit("completed", { sequence: 1, type: "completed", progress: { stage: "complete", completed: 2, total: 2 } });
    await vi.waitFor(() => expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" })));

    expect(FakeEventSource.last.closed).toHaveBeenCalledOnce();
  });
  it("bounds snapshot recovery after repeated stream errors", async () => {
    vi.useFakeTimers();
    try {
    const getJob = vi.fn().mockResolvedValue({ id: "job-1", status: "running", progress: { stage: "synthesis", completed: 1, total: 2 } });
    const client = new KenkuiServerClient("http://server.test", { getJob, eventSource: FakeEventSource });
    const stream = client.events("job-1");

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const disconnected = FakeEventSource.last;
      disconnected.onerror?.(new Event("error"));
      await vi.runAllTimersAsync();
      expect(getJob).toHaveBeenCalledTimes(attempt);
      expect(FakeEventSource.last).not.toBe(disconnected);
    }
    FakeEventSource.last.onerror?.(new Event("error"));

    expect(getJob).toHaveBeenCalledTimes(3);
    stream.close();
    } finally { vi.useRealTimers(); }
  });
  it("retrieves the server-authoritative job list", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ id: "job-1", status: "cancel_requested", progress: { stage: "cancelled", completed: 1, total: 2 } }] })));
    const client = new KenkuiServerClient("http://server.test", { fetch: fetcher });

    await expect(client.jobs()).resolves.toMatchObject({ items: [{ id: "job-1", status: "cancel_requested" }] });
  });
});

class FakeEventSource {
  static last: FakeEventSource;
  closed = vi.fn();
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private readonly listeners: Record<string, ((event: MessageEvent<string>) => void)[]> = {};
  constructor(_: string) { FakeEventSource.last = this; }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) { (this.listeners[type] ??= []).push(listener); }
  emit(type: string, payload: unknown) { for (const listener of this.listeners[type] ?? []) listener({ data: JSON.stringify(payload) } as MessageEvent<string>); }
  close() { this.closed(); }
}


it("recovers again after successful events reset consecutive failures", async () => {
  const getJob = vi.fn().mockResolvedValue({ id: "job-1", status: "running", progress: { stage: "synthesis", completed: 1, total: 9 } });
  const client = new KenkuiServerClient("", { getJob, eventSource: FakeEventSource });
  const stream = client.events("job-1");
  for (let sequence = 1; sequence <= 4; sequence += 1) {
    const source = FakeEventSource.last;
    source.emit("progress", { sequence, type: "progress", progress: { stage: "synthesis", completed: sequence, total: 9 } });
    source.onerror?.(new Event("error"));
    await vi.waitFor(() => expect(FakeEventSource.last).not.toBe(source));
  }
  expect(getJob).toHaveBeenCalledTimes(4);
  stream.close();
});

it("reports disconnection when recovery is exhausted", async () => {
  vi.useFakeTimers();
  try {
    const getJob = vi.fn().mockResolvedValue({ id: "job-1", status: "running", progress: { stage: "synthesis", completed: 1, total: 9 } });
    const onConnection = vi.fn();
    const client = new KenkuiServerClient("", { getJob, eventSource: FakeEventSource });
    const stream = client.events("job-1", undefined, undefined, onConnection);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      FakeEventSource.last.onerror?.(new Event("error"));
      await vi.runAllTimersAsync();
    }
    expect(onConnection).toHaveBeenLastCalledWith("disconnected");
    const exhausted = FakeEventSource.last;
    await stream.onDisconnect();
    expect(FakeEventSource.last).not.toBe(exhausted);
    expect(getJob).toHaveBeenCalledTimes(4);
    stream.close();
    const closed = FakeEventSource.last;
    await stream.onDisconnect();
    expect(FakeEventSource.last).toBe(closed);
  } finally { vi.useRealTimers(); }
});


it("announces authentication failures across JSON and binary requests and unsubscribes", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Expired" } }), { status: 401 }));
  const client = new KenkuiServerClient("", { fetch: fetcher });
  const expired = vi.fn();
  const unsubscribe = client.onUnauthorized(expired);
  await expect(client.billing()).rejects.toMatchObject({ status: 401 });
  await expect(client.cover("asset")).rejects.toMatchObject({ status: 401 });
  await expect(client.artifact("job")).rejects.toMatchObject({ status: 401 });
  expect(expired).toHaveBeenCalledTimes(3);
  unsubscribe();
  await expect(client.session()).rejects.toMatchObject({ status: 401 });
  expect(expired).toHaveBeenCalledTimes(3);
});

it("replaces stale sockets on resume and ignores events from the old connection", async () => {
  const getJob = vi.fn().mockResolvedValue({ id: "job-1", status: "running", progress: { stage: "synthesis", completed: 1, total: 9 } });
  const onEvent = vi.fn();
  const client = new KenkuiServerClient("", { getJob, eventSource: FakeEventSource });
  const stream = client.events("job-1", onEvent);
  const stale = FakeEventSource.last;
  await Promise.all([stream.onDisconnect(), stream.onDisconnect()]);
  expect(getJob).toHaveBeenCalledOnce();
  expect(FakeEventSource.last).not.toBe(stale);
  stale.emit("progress", { sequence: 99, type: "progress", progress: { stage: "synthesis", completed: 1, total: 9 } });
  expect(onEvent).not.toHaveBeenCalled();
  stream.close();
});
