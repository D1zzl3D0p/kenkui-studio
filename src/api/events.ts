import type { EventResponse, JobResponse } from "./generated/v1";

export interface JobEventStream {
  close(): void;
  onDisconnect(): Promise<JobResponse>;
}

export interface EventSourceLike {
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export type EventSourceFactory = new (url: string) => EventSourceLike;

export function connectJobEvents(
  url: string,
  EventSourceConstructor: EventSourceFactory,
  refetch: () => Promise<JobResponse>,
  onEvent?: (event: EventResponse) => void,
  onSnapshot?: (job: JobResponse) => void,
): JobEventStream {
  const source = new EventSourceConstructor(url);
  let reconnecting: Promise<JobResponse> | undefined;
  const recover = async () => {
    reconnecting ??= refetch().then((job) => {
      onSnapshot?.(job);
      return job;
    }).finally(() => { reconnecting = undefined; });
    return reconnecting;
  };
  const receive = (message: MessageEvent<string>) => {
    try { onEvent?.(JSON.parse(message.data) as EventResponse); } catch { /* malformed display event */ }
  };
  source.onmessage = receive;
  for (const type of ["running", "progress", "succeeded", "failed", "cancelled"]) source.addEventListener(type, receive);
  source.onerror = () => { void recover(); };
  return { close: () => source.close(), onDisconnect: recover };
}
