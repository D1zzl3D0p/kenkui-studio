import type { EventSourceFactory, EventSourceLike } from "../api/events";

/** One parsed server-sent event. `type` is "message" when the frame names no event. */
export interface EventFrame { type: string; data: string }

/** A transport-agnostic stream of frames, satisfied natively by a Tauri Channel. */
export interface EventChannel {
  onFrame(listener: (frame: EventFrame) => void): void;
  onError(listener: () => void): void;
  close(): void;
}

export type EventChannelFactory = (url: string) => EventChannel;

/**
 * Adapts a frame channel to the EventSource shape `connectJobEvents` expects,
 * so its reconnect and recovery logic is reused unchanged off the browser.
 */
export function channelEventSourceFactory(open: EventChannelFactory): EventSourceFactory {
  return class ChannelEventSource implements EventSourceLike {
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
    private readonly channel: EventChannel;

    constructor(url: string) {
      this.channel = open(url);
      this.channel.onFrame((frame) => {
        const message = new MessageEvent(frame.type, { data: frame.data }) as MessageEvent<string>;
        if (frame.type === "message") this.onmessage?.(message);
        for (const listener of this.listeners.get(frame.type) ?? []) listener(message);
      });
      this.channel.onError(() => this.onerror?.(new Event("error")));
    }

    addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    close(): void { this.channel.close(); }
  };
}
