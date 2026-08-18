import type { JobResponse } from "../api/generated/v1";

export function JobProgress({ job }: { job: JobResponse }) {
  const percent = job.progress.total === 0 ? 0 : Math.round((job.progress.completed / job.progress.total) * 100);
  return <section aria-label="Job progress"><p>Status: {job.status}</p><p>Stage: {job.progress.stage}</p><progress value={job.progress.completed} max={job.progress.total || 1}>{percent}%</progress><span>{percent}%</span></section>;
}
