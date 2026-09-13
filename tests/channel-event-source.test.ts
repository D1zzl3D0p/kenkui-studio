import { describe, expect, it, vi } from "vitest";
import { channelEventSourceFactory, type EventChannel, type EventFrame } from "../src/host/channel-event-source";
import { connectJobEvents } from "../src/api/events";

function fakeChannel() {
  let frame: (value: EventFrame) => void = () => undefined;
  let fail: () => void = () => undefined;
  const close = vi.fn();
  const channel: EventChannel = {
    onFrame: (listener) => { frame = listener; },
    onError: (listener) => { fail = listener; },
    close,
  };
  return { channel, close, emit: (value: EventFrame) => frame(value), fail: () => fail() };
}

describe("ChannelEventSource", () => {
  it("delivers named events to addEventListener subscribers", () => {
    const harness = fakeChannel();
    const Source = channelEventSourceFactory(() => harness.channel);
    const source = new Source("http://server.test/v1/jobs/job-1/events");
    const received: string[] = [];
    source.addEventListener("progress", (event) => received.push(event.data));

    harness.emit({ type: "progress", data: '{"sequence":1}' });

    expect(received).toEqual(['{"sequence":1}']);
  });

  it("delivers unnamed events to onmessage", () => {
    const harness = fakeChannel();
    const Source = channelEventSourceFactory(() => harness.channel);
    const source = new Source("http://server.test/v1/jobs/job-1/events");
    const received: string[] = [];
    source.onmessage = (event) => received.push(event.data);

    harness.emit({ type: "message", data: "plain" });

    expect(received).toEqual(["plain"]);
  });

  it("closes the underlying channel", () => {
    const harness = fakeChannel();
    const Source = channelEventSourceFactory(() => harness.channel);

    new Source("http://server.test/v1/jobs/job-1/events").close();

    expect(harness.close).toHaveBeenCalled();
  });

  it("preserves connectJobEvents recovery semantics on a channel transport", async () => {
    const harness = fakeChannel();
    const Source = channelEventSourceFactory(() => harness.channel);
    const refetch = vi.fn().mockResolvedValue({
      id: "job-1", status: "succeeded", progress: { stage: "complete", completed: 1, total: 1 },
    });
    const snapshots: string[] = [];

    const stream = connectJobEvents(
      "http://server.test/v1/jobs/job-1/events",
      Source,
      refetch,
      undefined,
      (job) => snapshots.push(job.status),
    );
    harness.fail();
    await stream.onDisconnect();

    expect(refetch).toHaveBeenCalled();
    expect(snapshots).toContain("succeeded");
  });
});
