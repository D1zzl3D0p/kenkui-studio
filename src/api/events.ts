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

const terminalStatuses: Record<string, true> = { succeeded: true, failed: true, cancelled: true };
const snapshotEvents: Record<string, true> = { completed: true, cancel_requested: true, failed: true, cancelled: true };
const MAX_RECOVERY_ATTEMPTS = 3;

export function connectJobEvents(
  url: string,
  EventSourceConstructor: EventSourceFactory,
  refetch: () => Promise<JobResponse>,
  onEvent?: (event: EventResponse) => void,
  onSnapshot?: (job: JobResponse) => void,
): JobEventStream {
  let source: EventSourceLike | undefined;
  let stopped = false;
  let attempts = 0;
  let retryTimer: number | undefined;
  let recovering: Promise<JobResponse> | undefined;

  const stop = () => {
    stopped = true;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    source?.close();
    source = undefined;
  };
  const recover = async () => {
    recovering ??= refetch().then((job) => {
      onSnapshot?.(job);
      if (terminalStatuses[job.status]) stop();
      return job;
    }).finally(() => { recovering = undefined; });
    return recovering;
  };
  const receive = (message: MessageEvent<string>) => {
    try {
      const event = JSON.parse(message.data) as EventResponse;
      onEvent?.(event);
      if (snapshotEvents[event.type]) void recover();
    } catch { /* malformed display event */ }
  };
  const connect = () => {
    if (stopped) return;
    const next = new EventSourceConstructor(url);
    source = next;
    next.onmessage = receive;
    for (const type of ["running", "progress", "completed", "cancel_requested", "failed", "cancelled"]) next.addEventListener(type, receive);
    next.onerror = () => {
      if (stopped || attempts >= MAX_RECOVERY_ATTEMPTS) { stop(); return; }
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
