import { useEffect, useRef, useState } from "react";
import { isTransientRequestError } from "../api/errors";
import type { KenkuiServerClient } from "../api/client";
import type { JobResponse } from "../api/generated/v1";
import type { Host } from "../host";

const terminal = new Set(["succeeded", "failed", "cancelled"]);

/** Own the lifetime of one job view's snapshots, event stream and fallback. */
export function useJobTracking({ id, client, host }: { id: string; client: KenkuiServerClient; host: Host }) {
  const [job, setJob] = useState<JobResponse>(),
    [error, setError] = useState<unknown>();
  const [connection, setConnection] = useState("connected"),
    [reload, setReload] = useState(0);
  const stopTracking = useRef<() => void>(() => {});
  useEffect(() => {
    let live = true,
      generation = 0,
      finished = false,
      lastEventId = "";
    let stream: ReturnType<KenkuiServerClient["events"]> | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let fetching = false,
      failures = 0;
    setError(undefined);
    setJob(undefined);
    setConnection("connected");
    const stop = () => {
      clearTimeout(poll);
      stream?.close();
      stream = undefined;
    };
    stopTracking.current = () => {
      finished = true;
      generation++;
      stop();
    };
    const update = (snapshot: JobResponse) => {
      if (!live) return;
      failures = 0;
      setError(undefined);
      setJob(snapshot);
      if (terminal.has(snapshot.status)) {
        finished = true;
        stop();
      }
    };
    const schedule = () => {
      clearTimeout(poll);
      if (live && !finished && document.visibilityState === "visible")
        poll = setTimeout(() => void refresh(), 5000);
    };
    const refresh = async () => {
      if (
        fetching ||
        !live ||
        finished ||
        document.visibilityState !== "visible"
      )
        return;
      fetching = true;
      const current = generation;
      try {
        const snapshot = await client.getJob(id);
        if (!live || current !== generation) return;
        update(snapshot);
        if (finished) return;
        try {
          stream = client.events(
            id,
            (event) => {
              if (!live || current !== generation) return;
              const state = (
                {
                  completed: "succeeded",
                  failed: "failed",
                  cancelled: "cancelled",
                  cancel_requested: "cancel_requested",
                } as const
              )[event.type as "completed"];
              setJob((job) => ({
                ...job,
                id,
                status: state || job?.status || "running",
                progress: event.progress,
              }));
            },
            update,
            (state,cause) => {
              if (!live || current !== generation) return;
              setConnection(state);
              if (state === "disconnected") {
                stop();
                if (cause && !isTransientRequestError(cause)) {
                  setError(cause);
                  stopTracking.current();
                } else schedule();
              }
            },
            {
              lastEventId,
              onCursor: (value) => {
                lastEventId = value;
              },
            },
          );
        } catch {
          // The snapshot established active work even if SSE is unavailable.
          setConnection("disconnected");
          schedule();
        }
      } catch (cause) {
        if (live && current === generation) {
          setConnection("disconnected");
          setError(cause);
          if (isTransientRequestError(cause) && ++failures <= 3) schedule();
          else stopTracking.current();
        }
      } finally {
        if (current === generation) fetching = false;
      }
    };
    const pause = () => {
      generation++;
      fetching = false;
      stop();
    };
    const hidden = () => {
      if (document.visibilityState !== "visible") pause();
    };
    document.addEventListener("visibilitychange", hidden);
    const off = host.onResume(() => {
      if (fetching || finished) return;
      pause();
      void refresh();
    });
    void refresh();
    return () => {
      live = false;
      pause();
      off();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [id, client, host, reload]);
  return { job, setJob, error, setError, connection, retry: () => setReload(n => n + 1), stop: () => stopTracking.current() };
}
