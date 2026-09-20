import { useEffect, useRef } from "react";
import type { JobResponse } from "../api/generated/v1";
import type { Host, Notice } from "../host";

/** The copy a finished book carries, matching the email the server sends. */
export function completionNotice(jobId: string, title?: string): Notice {
  return {
    title: title ? `“${title}” is ready` : "Your audiobook is ready",
    body: "Narration finished. Open Kenkui Studio to download it.",
    path: `/jobs/${encodeURIComponent(jobId)}`,
  };
}

/**
 * Raise a system notification when a book finishes anywhere in the studio.
 *
 * The shell already polls every job, so this needs no stream of its own and
 * works on whichever page the reader is on. It compares successive snapshots;
 * the first only seeds that comparison, because a book that finished before
 * this tab opened is not news.
 */
export function useCompletionNotices(
  jobs: JobResponse[] | undefined,
  host: Host,
  titleFor: (jobId: string) => string | undefined,
): void {
  const seen = useRef<Map<string, string> | undefined>(undefined);
  const lookup = useRef(titleFor);
  lookup.current = titleFor;
  useEffect(() => {
    if (!jobs) return;
    const before = seen.current;
    seen.current = new Map(jobs.map((job) => [job.id, job.status]));
    if (!before || !host.notifications) return;
    for (const job of jobs) {
      // A job absent from the last snapshot has no transition to report.
      const previous = before.get(job.id);
      if (previous === undefined || previous === job.status) continue;
      if (job.status !== "succeeded") continue;
      void host.notifications
        .show(completionNotice(job.id, job.title || lookup.current(job.id)))
        .catch(() => undefined);
    }
  }, [jobs, host]);
}
