import { useEffect, useState } from "react";
import type { Capabilities } from "./api/generated/v1";
import { KenkuiServerClient } from "./api/client";
import { ErrorMessage } from "./components/error-message";
import { BillingPage } from "./pages/billing";
import { JobPage } from "./pages/job";
import { JobsPage } from "./pages/jobs";
import { NewJobPage } from "./pages/new-job";
import { SignInPage } from "./pages/sign-in";
import { parseRoute } from "./router";
import type { Host } from "./host/index";

interface AppProps { client: KenkuiServerClient; host: Host; initialPath?: string }

export function App({ client, host, initialPath }: AppProps) {
  const [path, setPath] = useState(initialPath ?? window.location.pathname);
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [error, setError] = useState<unknown>();
  useEffect(() => { void client.capabilities().then(setCapabilities).catch(setError); }, [client]);
  useEffect(() => { const sync = () => setPath(window.location.pathname); window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync); }, []);
  const navigate = (next: string) => { if (!initialPath) window.history.pushState({}, "", next); setPath(next); };
  if (error) return <main><h1>Kenkui Studio</h1><ErrorMessage error={error} />
    {host.can.chooseServer && <button type="button" onClick={() => navigate("/servers")}>Choose another server</button>}
  </main>;
  if (!capabilities) return <main><h1>Kenkui Studio</h1><p>Connecting to server…</p></main>;
  const route = parseRoute(path);
  const creditBilling = capabilities.billing.mode === "credits";
  return <><nav aria-label="Main navigation"><a href="/jobs" onClick={(event) => { event.preventDefault(); navigate("/jobs"); }}>Jobs</a><a href="/jobs/new" onClick={(event) => { event.preventDefault(); navigate("/jobs/new"); }}>New job</a>{creditBilling && <a href="/billing" onClick={(event) => { event.preventDefault(); navigate("/billing"); }}>Billing</a>}</nav>
    {route.page === "new-job" && <NewJobPage client={client} capabilities={capabilities} onCreated={(jobId) => navigate(`/jobs/${encodeURIComponent(jobId)}`)} />}
    {route.page === "job" && route.jobId && <JobPage client={client} host={host} jobId={route.jobId} />}
    {route.page === "billing" && <BillingPage client={client} capabilities={capabilities} />}
    {route.page === "sign-in" && <SignInPage capabilities={capabilities} />}
    {route.page === "jobs" && <JobsPage client={client} onOpen={(jobId) => navigate(`/jobs/${encodeURIComponent(jobId)}`)} onCreate={() => navigate("/jobs/new")} />}
  </>;
}
