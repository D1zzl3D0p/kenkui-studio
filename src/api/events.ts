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

export type EventSourceFactory = new (url: string, options?: EventSourceInit) => EventSourceLike;

const terminalStatuses: Record<string, true> = { succeeded: true, failed: true, cancelled: true };
const snapshotEvents: Record<string, true> = { completed: true, cancel_requested: true, failed: true, cancelled: true };
const MAX_RECOVERY_ATTEMPTS = 3;

export function connectJobEvents(
  url: string,
  EventSourceConstructor: EventSourceFactory,
  refetch: () => Promise<JobResponse>,
  onEvent?: (event: EventResponse) => void,
  onSnapshot?: (job: JobResponse) => void,
  onConnection?: (state: "connected" | "reconnecting" | "disconnected") => void,
): JobEventStream {
  let source: EventSourceLike | undefined;
  let stopped = false;
  let attempts = 0;
  let retryTimer: number | undefined;
  let lastSequence = 0;
  let revision = 0;
  let recovering: Promise<JobResponse> | undefined;

  const stop = () => {
    stopped = true;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    source?.close();
    source = undefined;
  };
  const recover = async () => {
    const requestedAt = revision;
    recovering ??= refetch().then((job) => {
      if (stopped) return job;
      if (requestedAt === revision) {
        onSnapshot?.(job);
        if (terminalStatuses[job.status]) stop();
      }
      return job;
    }).finally(() => { recovering = undefined; });
    return recovering;
  };
  const receive = (message: MessageEvent<string>) => {
    try {
      const event = JSON.parse(message.data) as EventResponse;
      if (stopped || !Number.isInteger(event.sequence) || event.sequence <= lastSequence) return;
      if (!event.progress || typeof event.type !== "string") return;
      lastSequence = event.sequence;
      revision += 1;
      attempts = 0;
      onConnection?.("connected");
      onEvent?.(event);
      if (snapshotEvents[event.type]) void recover().catch(() => onConnection?.("disconnected"));
    } catch { /* malformed display event */ }
  };
  const connect = () => {
    if (stopped) return;
    const next = new EventSourceConstructor(url, { withCredentials: true });
    source = next;
    next.onmessage = receive;
    for (const type of ["running", "progress", "completed", "cancel_requested", "failed", "cancelled"]) next.addEventListener(type, receive);
    next.onerror = () => {
      if (stopped || source !== next) return;
      if (attempts >= MAX_RECOVERY_ATTEMPTS) { onConnection?.("disconnected"); stop(); return; }
      onConnection?.("reconnecting");
      attempts += 1;
      next.close();
      if (source === next) source = undefined;
      void recover().then((job) => {
        if (stopped || terminalStatuses[job.status]) return;
        retryTimer = setTimeout(connect, attempts * 100);
      }).catch(() => {
        if (!stopped) retryTimer = setTimeout(connect, attempts * 100);
      });
    };
  };
  connect();
  return { close: stop, onDisconnect: recover };
}
