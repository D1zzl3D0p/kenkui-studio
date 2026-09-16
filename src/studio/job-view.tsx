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
  const [busy, setBusy] = useState(false),
    [audio, setAudio] = useState<string>();
  useEffect(() => {
    let live = true,
      events = 0;
    setError(undefined);
    setJob(undefined);
    setConnection("connected");
    const update = (snapshot: JobResponse) => {
      if (live) setJob((current) => ({ ...current, ...snapshot }));
    };
    const refresh = () =>
      client
        .getJob(id)
        .then(update)
        .catch((cause) => {
          if (live) setError(cause);
        });
    void client
      .getJob(id)
      .then((snapshot) => {
        if (!events) update(snapshot);
      })
      .catch((cause) => {
        if (live) setError(cause);
      });
    let stream: ReturnType<KenkuiServerClient["events"]> | undefined;
    try {
      stream = client.events(
        id,
        (event) => {
          if (!live) return;
          events++;
          const state = (
            {
              completed: "succeeded",
              failed: "failed",
              cancelled: "cancelled",
              cancel_requested: "cancel_requested",
            } as const
          )[event.type as "completed"];
          setJob((current) => ({
            ...current,
            id,
            status: state || current?.status || "running",
            progress: event.progress,
          }));
          if (state && terminal.has(state)) void refresh();
        },
        update,
        (state) => {
          if (live) setConnection(state);
        },
      );
    } catch {
      setConnection("disconnected");
    }
    const off = host.onResume(() => {
      void refresh();
      if (stream)
        void stream.onDisconnect().catch((cause) => {
          if (live) setError(cause);
        });
    });
    const poll = setInterval(() => {
      if (!stream && document.visibilityState === "visible") void refresh();
    }, 5000);
    return () => {
      live = false;
      stream?.close();
      off();
      clearInterval(poll);
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
    setBusy(true);
    setError(undefined);
    try {
      await host.saveArtifact(
        { url: client.artifactUrl(id), load: () => client.artifact(id) },
        `${title.replace(/[\\/:*?"<>|]/g, "_")}.m4b`,
      );
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
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
            <p role="status">Loading conversion…</p>
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
                        setJob(await client.cancelJob(id));
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
                    {busy ? "Preparing audio…" : "Download M4B"}
                  </button>
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
