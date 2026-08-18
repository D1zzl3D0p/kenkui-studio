interface JobsPageProps { onOpen(jobId: string): void; onCreate(): void }

export function JobsPage({ onOpen, onCreate }: JobsPageProps) {
  let jobId = "";
  return <main><h1>Jobs</h1><p>Open a job by its server-issued ID.</p><form onSubmit={(event) => { event.preventDefault(); if (jobId.trim()) onOpen(jobId.trim()); }}><label>Job ID<input onChange={(event) => { jobId = event.target.value; }} /></label><button type="submit">Open job</button></form><button type="button" onClick={onCreate}>Create job</button></main>;
}
