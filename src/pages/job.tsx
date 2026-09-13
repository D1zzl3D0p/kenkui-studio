import { useEffect, useState } from "react";
import type { JobResponse } from "../api/generated/v1";
import { KenkuiServerClient } from "../api/client";
import { ErrorMessage } from "../components/error-message";
import { JobProgress } from "../components/job-progress";
import type { Host } from "../host/index";

interface JobPageProps { client: KenkuiServerClient; host: Host; jobId: string }
const cancelUnavailable: Record<string, true> = { succeeded: true, failed: true, cancelled: true, cancel_requested: true };
const statusByEvent: Record<string, JobResponse["status"]> = {
  completed: "succeeded",
  cancel_requested: "cancel_requested",
  failed: "failed",
  cancelled: "cancelled",
};

export function JobPage({ client, host, jobId }: JobPageProps) {
  const [job, setJob] = useState<JobResponse>();
  const [error, setError] = useState<unknown>();
  const [downloading, setDownloading] = useState(false);
  const [connection, setConnection] = useState("connected");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    let eventsSeen = 0;
    setJob(undefined);
    setError(undefined);
    setConnection("connected");
    const update = (snapshot: JobResponse) => { if (active) setJob(snapshot); };
    const updateFromEvent = (event: { type: string; progress: JobResponse["progress"] }) => {
      if (!active) return;
      eventsSeen += 1;
      setJob((current) => ({ id: jobId, status: statusByEvent[event.type] ?? current?.status ?? "running", progress: event.progress }));
    };
    void client.getJob(jobId).then((snapshot) => { if (eventsSeen === 0) update(snapshot); }).catch((cause) => { if (active) setError(cause); });
    const stream = client.events(jobId, updateFromEvent, update, (state) => { if (active) setConnection(state); });
    const unsubscribe = host.onResume(() => { void stream.onDisconnect().catch((cause) => { if (active) setError(cause); }); });
    return () => { active = false; unsubscribe(); stream.close(); };
  }, [client, host, jobId, reload]);
  const cancel = async () => { try { setJob(await client.cancelJob(jobId)); } catch (cause) { setError(cause); } };
  const download = async () => {
    try {
      setDownloading(true);
      await host.saveArtifact({ url: client.artifactUrl(jobId), load: () => client.artifact(jobId) }, `${jobId}.m4b`);
    } catch (cause) { setError(cause); } finally { setDownloading(false); }
  };
  return <main><h1>Job {jobId}</h1><ErrorMessage error={error} />{connection !== "connected" && <p role="status">{connection === "reconnecting" ? "Reconnecting to job updates…" : "Job updates disconnected."}<button type="button" onClick={() => setReload((value) => value + 1)}>Refresh updates</button></p>}{job ? <><JobProgress job={job} />{job.failure && <p role="alert">{job.failure.message}</p>}<button type="button" onClick={cancel} disabled={Boolean(cancelUnavailable[job.status])}>Cancel job</button>{job.status === "succeeded" && <button type="button" onClick={download} disabled={downloading}>{downloading ? "Preparing download" : "Download M4B"}</button>}</> : <p>Loading job…</p>}</main>;
}
