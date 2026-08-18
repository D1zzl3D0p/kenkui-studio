import { useEffect, useState } from "react";
import type { JobResponse } from "../api/generated/v1";
import { KenkuiServerClient } from "../api/client";
import { ErrorMessage } from "../components/error-message";
import { JobProgress } from "../components/job-progress";

interface JobPageProps { client: KenkuiServerClient; jobId: string }
const cancelUnavailable: Record<string, true> = { succeeded: true, failed: true, cancelled: true, cancel_requested: true };

export function JobPage({ client, jobId }: JobPageProps) {
  const [job, setJob] = useState<JobResponse>();
  const [error, setError] = useState<unknown>();
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    let active = true;
    const update = (snapshot: JobResponse) => { if (active) setJob(snapshot); };
    void client.getJob(jobId).then(update).catch(setError);
    const stream = client.events(jobId, (event) => update({ id: jobId, status: job?.status ?? "running", progress: event.progress }), update);
    return () => { active = false; stream.close(); };
  }, [client, jobId]);
  const cancel = async () => { try { setJob(await client.cancelJob(jobId)); } catch (cause) { setError(cause); } };
  const download = async () => {
    try {
      setDownloading(true);
      const blob = await client.artifact(jobId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = `${jobId}.m4b`; link.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause); } finally { setDownloading(false); }
  };
  return <main><h1>Job {jobId}</h1><ErrorMessage error={error} />{job ? <><JobProgress job={job} /><button type="button" onClick={cancel} disabled={Boolean(cancelUnavailable[job.status])}>Cancel job</button>{job.status === "succeeded" && <button type="button" onClick={download} disabled={downloading}>{downloading ? "Preparing download" : "Download M4B"}</button>}</> : <p>Loading job…</p>}</main>;
}
