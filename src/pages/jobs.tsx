import { useEffect, useState } from "react";
import type { JobResponse } from "../api/generated/v1";
import { KenkuiServerClient } from "../api/client";
import { ErrorMessage } from "../components/error-message";

interface JobsPageProps { client: KenkuiServerClient; onOpen(jobId: string): void; onCreate(): void }

export function JobsPage({ client, onOpen, onCreate }: JobsPageProps) {
  const [jobs, setJobs] = useState<JobResponse[]>();
  const [error, setError] = useState<unknown>();
  useEffect(() => { void client.jobs().then(({ items }) => setJobs(items)).catch(setError); }, [client]);
  return <main><h1>Jobs</h1><ErrorMessage error={error} />{jobs ? jobs.length === 0 ? <p>No jobs yet.</p> : <ul>{jobs.map((job) => <li key={job.id}><button type="button" onClick={() => onOpen(job.id)}>{job.id}</button><span>{job.status}</span><span>{job.progress.stage} {job.progress.completed}/{job.progress.total}</span></li>)}</ul> : <p>Loading jobs…</p>}<button type="button" onClick={onCreate}>Create job</button></main>;
}
