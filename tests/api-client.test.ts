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
  it("delivers named server events", () => {
    const onEvent = vi.fn();
    const client = new KenkuiServerClient("http://server.test", { getJob: vi.fn(), eventSource: FakeEventSource });
    client.events("job-1", onEvent);

    FakeEventSource.last.emit("progress", { sequence: 1, type: "progress", progress: { stage: "synthesis", completed: 1, total: 2 } });

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "progress" }));
  });
});

class FakeEventSource {
  static last: FakeEventSource;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private readonly listeners: Record<string, ((event: MessageEvent<string>) => void)[]> = {};
  constructor(_: string) { FakeEventSource.last = this; }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) { (this.listeners[type] ??= []).push(listener); }
  emit(type: string, payload: unknown) { for (const listener of this.listeners[type] ?? []) listener({ data: JSON.stringify(payload) } as MessageEvent<string>); }
  close() {}
}
