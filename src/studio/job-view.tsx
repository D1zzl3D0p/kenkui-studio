import { isTransientRequestError } from "../api/errors";
import { useEffect, useRef, useState } from "react";
import type { KenkuiServerClient } from "../api/client";
import type { Capabilities, JobResponse } from "../api/generated/v1";
import type { Host } from "../host";
import { ErrorMessage } from "../components/error-message";
import { BookCover } from "./cover";
import type { Record } from "./store";
const terminal = new Set(["succeeded", "failed", "cancelled"]);
export const statusLabel = (status: string) =>
  ({
    queued: "Queued",
    running: "Creating",
    cancel_requested: "Cancellation requested",
    succeeded: "Ready",
    failed: "Failed",
    cancelled: "Cancelled",
  })[status] || status;
export function JobView({
  id,
  client,
  host,
  capabilities,
  record,
  onHome,
  onChanged,
}: {
  id: string;
  client: KenkuiServerClient;
  host: Host;
  capabilities: Capabilities;
  record?: Record;
  onHome(): void;
  onChanged(): void;
}) {
  const alive = useRef(true);
  const downloadController = useRef<AbortController | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ received: number; total?: number | null; phase?: "sharing" }>();
  useEffect(() => () => { downloadController.current?.abort(); }, [id]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [job, setJob] = useState<JobResponse>(),
    [error, setError] = useState<unknown>();
  const [connection, setConnection] = useState("connected"),
    [reload, setReload] = useState(0);
  const stopTracking = useRef<() => void>(() => {});
  const [busy, setBusy] = useState(false),
    [audio, setAudio] = useState<string>();
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
  useEffect(() => {
    if (job && terminal.has(job.status)) onChanged();
  }, [job?.status]); // caller only refreshes snapshots/balance
  useEffect(
    () => () => {
      if (audio) URL.revokeObjectURL(audio);
    },
    [audio],
  );
  const title = job?.title || record?.title || "Audiobook",
    author = job?.author || record?.author || "";
  async function download() {
    const controller = new AbortController();
    downloadController.current = controller;
    if (host.platform !== "web") setDownloadProgress({ received: 0 });
    setBusy(true);
    setError(undefined);
    try {
      await host.saveArtifact(
        { url: client.artifactUrl(id), load: () => client.artifact(id) },
        `${title.replace(/[\\/:*?"<>|]/g, "_")}.m4b`,
        { signal: controller.signal, onProgress: (progress) => {
          if (alive.current && !controller.signal.aborted) setDownloadProgress(progress);
        } },
      );
    } catch (cause) {
      if (alive.current && !(cause instanceof DOMException && cause.name === "AbortError")) setError(cause);
    } finally {
      downloadController.current = null;
      if (alive.current) { setBusy(false); setDownloadProgress(undefined); }
    }
  }
  async function listen() {
    setBusy(true);
    setError(undefined);
    try {
      const blob = await client.artifact(id);
      if (alive.current) setAudio(URL.createObjectURL(blob));
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="workspace-top">
        <button className="text-button" onClick={onHome}>
          ← Your books
        </button>
      </div>
      <div className="workspace job-workspace">
        <aside className="book-identity">
          <BookCover
            title={title}
            author={author}
            sourceId={job?.sourceId || record?.sourceId}
            client={client}
            enabled={Boolean(
              capabilities.covers?.read &&
              (job?.sourceCover ?? record?.sourceCover) !== false,
            )}
          />
          <div className="identity-copy">
            <h1>{title}</h1>
            <p>{author}</p>
          </div>
        </aside>
        <section className="editor">
          <ErrorMessage error={error} />
          {!job ? (
            error ? <button className="secondary" onClick={() => setReload(n => n+1)}>Retry job</button> : <p role="status">Loading conversion…</p>
          ) : (
            <>
              <div className="eyebrow">{statusLabel(job.status)}</div>
              <h2>
                {job.status === "succeeded"
                  ? "Your audiobook is ready"
                  : job.status === "failed"
                    ? "Conversion failed"
                    : job.status === "cancelled"
                      ? "Conversion cancelled"
                      : job.status === "cancel_requested"
                        ? "Cancelling conversion"
                        : "Creating your audiobook"}
              </h2>
              <p className="muted" role="status">
                Status:{" "}
                {job.status === "cancel_requested"
                  ? "Cancellation requested"
                  : job.status}
              </p>
              {connection !== "connected" && !terminal.has(job.status) && (
                <p role="status">
                  {connection === "reconnecting"
                    ? "Reconnecting to progress updates…"
                    : "Progress updates disconnected."}
                  <button
                    className="text-button"
                    onClick={() => setReload((n) => n + 1)}
                  >
                    Refresh updates
                  </button>
                </p>
              )}
              {!terminal.has(job.status) && (
                <>
                  <div className="progress-heading">
                    <span>{job.progress.stage.replace(/[_-]/g, " ")}</span>
                    <strong>
                      {job.progress.total
                        ? `${Math.round((job.progress.completed / job.progress.total) * 100)}%`
                        : "In progress"}
                    </strong>
                  </div>
                  <progress
                    max={job.progress.total || 1}
                    value={
                      job.progress.total ? job.progress.completed : undefined
                    }
                  />
                  <p className="quiet">
                    Progress within the current stage. You can leave this page
                    and return later.
                  </p>

                  <button
                    className="secondary"
                    disabled={busy || job.status === "cancel_requested"}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const cancelled = await client.cancelJob(id);
                        if (terminal.has(cancelled.status)) stopTracking.current();
                        setJob(cancelled);
                        onChanged();
                      } catch (cause) {
                        setError(cause);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Cancel conversion
                  </button>
                </>
              )}
              <details>
                <summary>Conversion details</summary>
                <p>
                  Job ID: <code>{job.id}</code>
                </p>
                <p>Stage: {job.progress.stage}</p>
                <p>
                  {job.progress.completed} of{" "}
                  {job.progress.total || "an unknown number of"} items
                </p>
              </details>
              {job.failure && <p role="alert">{job.failure.message}</p>}
              {["failed", "cancelled"].includes(job.status) && (
                <p className="quiet">
                  {capabilities.billing?.mode === "credits"
                    ? "Reserved credits are released when the job finishes failing or cancelling. Check billing for your current balance."
                    : "You can start a new conversion from Your books."}
                </p>
              )}
              {job.status === "succeeded" && (
                <>
                  <div className="ready-symbol" aria-hidden="true">
                    ✓
                  </div>
                  <button
                    className="primary full"
                    disabled={busy}
                    onClick={() => void download()}
                  >
                    {downloadProgress?.phase === "sharing" ? "Choose where to save or share…" : downloadProgress ? "Downloading…" : busy ? "Preparing audio…" : host.platform === "mobile" ? "Save or share M4B" : "Download M4B"}
                  </button>
                  {downloadProgress && downloadProgress.phase !== "sharing" && (
                    <div>
                      <p role="status">
                        Downloaded {(downloadProgress.received / 1048576).toFixed(1)} MB
                        {downloadProgress.total ? ` of ${(downloadProgress.total / 1048576).toFixed(1)} MB` : ""}
                      </p>
                      <progress aria-label="Download progress" max={downloadProgress.total || 1}
                        value={downloadProgress.total ? downloadProgress.received : undefined} />
                      <button className="text-button" onClick={() => downloadController.current?.abort()}>Cancel download</button>
                    </div>
                  )}
                  {audio ? (
                    <audio
                      className="result-player"
                      controls
                      src={audio}
                      onError={() =>
                        setError(
                          new Error(
                            "This browser cannot play the audiobook. Download the M4B to listen in your player.",
                          ),
                        )
                      }
                    />
                  ) : (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void listen()}
                    >
                      Listen in browser
                    </button>
                  )}
                  <p className="quiet">
                    Browser playback loads the audiobook into memory. Download
                    for offline listening.
                  </p>
                  {capabilities.billing?.mode === "credits" && (
                    <p className="quiet">
                      Hosted downloads are retained for 30 days after completion.
                      Save your M4B before then; Studio is not permanent storage.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
