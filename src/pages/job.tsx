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
  useEffect(() => {
    let active = true;
    const update = (snapshot: JobResponse) => { if (active) setJob(snapshot); };
    const updateFromEvent = (event: { type: string; progress: JobResponse["progress"] }) => {
      if (!active) return;
      setJob((current) => ({ id: jobId, status: statusByEvent[event.type] ?? current?.status ?? "running", progress: event.progress }));
    };
    void client.getJob(jobId).then(update).catch(setError);
    const stream = client.events(jobId, updateFromEvent, update);
    const unsubscribe = host.onResume(() => { void stream.onDisconnect().catch(setError); });
    return () => { active = false; unsubscribe(); stream.close(); };
  }, [client, host, jobId]);
  const cancel = async () => { try { setJob(await client.cancelJob(jobId)); } catch (cause) { setError(cause); } };
  const download = async () => {
    try {
      setDownloading(true);
      await host.saveArtifact(await client.artifact(jobId), `${jobId}.m4b`);
    } catch (cause) { setError(cause); } finally { setDownloading(false); }
  };
  return <main><h1>Job {jobId}</h1><ErrorMessage error={error} />{job ? <><JobProgress job={job} /><button type="button" onClick={cancel} disabled={Boolean(cancelUnavailable[job.status])}>Cancel job</button>{job.status === "succeeded" && <button type="button" onClick={download} disabled={downloading}>{downloading ? "Preparing download" : "Download M4B"}</button>}</> : <p>Loading job…</p>}</main>;
}
