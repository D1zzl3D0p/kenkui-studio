import type { EventChannel, EventFrame } from "./channel-event-source";

export function fetchEventChannel(
  request: typeof fetch,
  url: string,
  cursor?: string,
): EventChannel {
  const controller = new AbortController();
  let deliver = (_frame: EventFrame) => {},
    failed = () => {};
  async function read() {
    const headers = new Headers({ Accept: "text/event-stream" });
    if (cursor && cursor !== "0") headers.set("Last-Event-ID", cursor);
    const response = await request(url, { headers, signal: controller.signal });
    if (
      !response.ok ||
      response.headers.get("content-type")?.split(";")[0] !==
        "text/event-stream" ||
      !response.body
    )
      throw new Error("Stream unavailable.");
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let pending = "",
      size = 0,
      type = "",
      id = "",
      data: string[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done && !pending.endsWith("\r")) break;
        pending += done ? "\n" : value;
        let offset = 0;
        for (const line of pending.matchAll(/\r\n|\n|\r(?!$)/g)) {
          const field = pending.slice(offset, line.index);
          offset = line.index! + line[0].length;
          size += field.length + 1;
          if (size > 1048576) throw new Error("Event exceeded size limit.");
          if (!field) {
            if (data.length)
              deliver({ type: type || "message", data: data.join("\n"), id });
            type = "";
            id = "";
            data = [];
            size = 0;
          } else {
            const colon = field.indexOf(":");
            const name = colon < 0 ? field : field.slice(0, colon);
            const value =
              colon < 0 ? "" : field.slice(colon + 1).replace(/^ /, "");
            if (name === "data") data.push(value);
            if (name === "event") type = value;
            if (name === "id") id = value;
          }
        }
        pending = pending.slice(offset);
        if (pending.length + size > 1048576)
          throw new Error("Event exceeded size limit.");
      }
    } finally {
      reader.releaseLock();
    }
  }
  const disconnected = () => {
    if (!controller.signal.aborted) {
      controller.abort();
      failed();
    }
  };
  void read().then(disconnected, disconnected);
  return {
    onFrame(fn) {
      deliver = fn;
    },
    onError(fn) {
      failed = fn;
    },
    close() {
      controller.abort();
    },
  };
}
