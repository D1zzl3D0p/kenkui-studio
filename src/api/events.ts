import { isTransientRequestError } from "./errors";
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

export type EventSourceFactory = new (url: string, options?: EventSourceInit & {lastEventId?: string}) => EventSourceLike;

const terminalStatuses: Record<string, true> = { succeeded: true, failed: true, cancelled: true };
const snapshotEvents: Record<string, true> = { completed: true, cancel_requested: true, failed: true, cancelled: true };
const MAX_RECOVERY_ATTEMPTS = 3;

export function connectJobEvents(
  url: string,
  EventSourceConstructor: EventSourceFactory,
  refetch: () => Promise<JobResponse>,
  onEvent?: (event: EventResponse) => void,
  onSnapshot?: (job: JobResponse) => void,
  onConnection?: (state: "connected" | "reconnecting" | "disconnected", cause?: unknown) => void,
  cursor?: {lastEventId: string; onCursor(id: string): void},
): JobEventStream {
  let source: EventSourceLike | undefined;
  let stopped = false;
  let disposed = false;
  let finished = false;
  let generation = 0;
  let resuming: Promise<JobResponse> | undefined;
  let attempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSequence = BigInt(cursor?.lastEventId || 0);
  let latest: JobResponse | undefined;
  let revision = 0;
  let recovering: Promise<JobResponse> | undefined;

  const stop = () => {
    stopped = true;
    generation += 1;
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
        latest = job;
        onSnapshot?.(job);
        if (terminalStatuses[job.status]) { finished = true; stop(); }
      }
      return job;
    }).finally(() => { recovering = undefined; });
    return recovering;
  };
  const receive = (message: MessageEvent<string>) => {
    try {
      const event = JSON.parse(message.data) as EventResponse;
      const id =
        message.lastEventId ||
        (Number.isSafeInteger(event.sequence) ? String(event.sequence) : "");
      if (
        stopped ||
        !Number.isInteger(event.sequence) ||
        event.sequence !== Number(id) ||
        !/^[1-9][0-9]{0,18}$/.test(id) ||
        BigInt(id) <= lastSequence
      )
        return;
      if (!event.progress || typeof event.type !== "string") return;
      lastSequence = BigInt(id);
      cursor?.onCursor(id);
      revision += 1;
      attempts = 0;
      onConnection?.("connected");
      onEvent?.(event);
      if (snapshotEvents[event.type]) void recover().catch(cause => {if (!stopped) {stop(); onConnection?.("disconnected",cause);}});
    } catch { /* malformed display event */ }
  };
  const connect = () => {
    if (stopped) return;
    const next = new EventSourceConstructor(url, { lastEventId: lastSequence.toString() });
    source = next;
    const receiveCurrent = (message: MessageEvent<string>) => { if (source === next) receive(message); };
    next.onmessage = receiveCurrent;
    for (const type of ["running", "progress", "completed", "cancel_requested", "failed", "cancelled"]) next.addEventListener(type, receiveCurrent);
    next.onerror = () => {
      if (stopped || source !== next) return;
      if (attempts >= MAX_RECOVERY_ATTEMPTS) { onConnection?.("disconnected"); stop(); return; }
      const reconnectGeneration = generation;
      onConnection?.("reconnecting");
      attempts += 1;
      next.close();
      if (source === next) source = undefined;
      void recover().then((job) => {
        if (stopped || reconnectGeneration !== generation || terminalStatuses[job.status]) return;
        retryTimer = setTimeout(connect, attempts * 100);
      }).catch(cause => {
        if (stopped || reconnectGeneration !== generation) return;
        if (!isTransientRequestError(cause)) {stop(); onConnection?.("disconnected",cause); return;}
        retryTimer = setTimeout(connect, attempts * 100);
      });
    };
  };
  connect();
  return {
    close: () => { disposed = true; stop(); },
    onDisconnect: () => {
      if (disposed || finished) return latest ? Promise.resolve(latest) : Promise.reject(new Error("Stream closed"));
      if (resuming) return resuming;
      // A mobile suspension can exhaust retries or leave an apparently live socket.
      stop();
      stopped = false;
      attempts = 0;
      onConnection?.("reconnecting");
      resuming = recover().then((job) => {
        if (!stopped && !terminalStatuses[job.status]) connect();
        return job;
      }).catch((error) => {
        if (!disposed) { onConnection?.("disconnected"); stop(); }
        throw error;
      }).finally(() => { resuming = undefined; });
      return resuming;
    },
  };
}
