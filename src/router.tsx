export type Route = { page: "jobs" | "new-job" | "job" | "billing" | "sign-in"; jobId?: string };

export function parseRoute(pathname: string): Route {
  if (pathname === "/jobs/new") return { page: "new-job" };
  const job = pathname.match(/^\/jobs\/([^/]+)$/);
  if (job) return { page: "job", jobId: decodeURIComponent(job[1]) };
  if (pathname === "/billing") return { page: "billing" };
  if (pathname === "/sign-in") return { page: "sign-in" };
  return { page: "jobs" };
}
