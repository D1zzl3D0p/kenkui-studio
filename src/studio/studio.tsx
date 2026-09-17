import { useEffect, useRef, useState } from "react";
import type { KenkuiServerClient } from "../api/client";
import type {
  Capabilities,
  JobResponse,
  VoiceResponse,
} from "../api/generated/v1";
import type { Host } from "../host";
import { ErrorMessage } from "../components/error-message";
import { BillingPage } from "../pages/billing";
import { AccountMenu } from "../components/account-menu";
import { ServersPage } from "../pages/servers";
import { Composer } from "./composer";
import { BookCover } from "./cover";
import { JobView, statusLabel } from "./job-view";
import {
  changeDraft,
  defaultSpeechSettings,
  defaultPauseLengths,
  readLibrary,
  uid,
  type Draft,
  type Record,
} from "./store";

function routeId(path: string, prefix: string): string | undefined {
  if (!path.startsWith(prefix)) return;
  try {
    return decodeURIComponent(path.slice(prefix.length));
  } catch {
    return;
  }
}
export function Studio({
  client,
  host,
  cap,
  scope,
  initialPath,
}: {
  client: KenkuiServerClient;
  host: Host;
  cap: Capabilities;
  scope: string;
  initialPath?: string;
}) {
  const key = `kenkui-studio-library-v1:${scope}`;
  const [library, setLibrary] = useState(() => readLibrary(key));
  const [path, setPath] = useState(initialPath || window.location.pathname);
  const [voices, setVoices] = useState<VoiceResponse[]>([]),
    [jobs, setJobs] = useState<JobResponse[]>();
  const [balance, setBalance] = useState<string>();
  const [error, setError] = useState<unknown>(),
    [jobsError, setJobsError] = useState<unknown>(),
    [voiceError, setVoiceError] = useState<unknown>();
  const [savingError, setSavingError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<{
    type: "draft" | "job";
    id: string;
  }>();
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("kenkui-studio-theme") || "system";
    } catch {
      return "system";
    }
  });
  const input = useRef<HTMLInputElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    uploading = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("kenkui-studio-theme", theme);
    } catch {
      /* theme remains usable */
    }
  }, [theme]);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(library));
      setSavingError("");
    } catch {
      setSavingError(
        "This browser could not save your draft. Keep this tab open until you finish.",
      );
    }
  }, [key, library]);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    let live = true;
    void client
      .voices()
      .then((result) => {
        if (live) {
          setVoices(result.items);
          setVoiceError(undefined);
        }
      })
      .catch((cause) => {
        if (live) setVoiceError(cause);
      });
    return () => {
      live = false;
    };
  }, [client, refresh]);
  useEffect(() => {
    let live = true,
      fetching = false;
    const load = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const result = await client.jobs();
        if (live) {
          setJobs(result.items);
          setJobsError(undefined);
        }
      } catch (cause) {
        if (live) setJobsError(cause);
      } finally {
        fetching = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [client, refresh]);
  useEffect(() => {
    if (cap.billing?.mode !== "credits") return;
    let live = true;
    void client
      .billing()
      .then((value) => {
        if (live) setBalance(value.availableCredits ?? undefined);
      })
      .catch(() => {
        if (live) setBalance(undefined);
      });
    return () => {
      live = false;
    };
  }, [client, cap.billing?.mode, refresh, path]);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [selected]);
  function navigate(next: string) {
    if (!initialPath) window.history.pushState({}, "", next);
    setPath(next);
    setSelected(undefined);
    setError(undefined);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const draftId = routeId(path, "/drafts/"),
    jobId = path === "/jobs/new" ? undefined : routeId(path, "/jobs/");
  const draft = library.drafts.find((d) => d.id === draftId);
  const update = (patch: Partial<Draft>) =>
    setLibrary((l) => ({
      ...l,
      drafts: l.drafts.map((d) =>
        d.id === draftId ? changeDraft(d, patch) : d,
      ),
    }));
  function billing() {
    try {
      sessionStorage.setItem(`${key}:return`, path);
    } catch {
      /* optional */
    }
    navigate("/billing");
  }
  function backFromBilling() {
    let next = "/";
    try {
      next = sessionStorage.getItem(`${key}:return`) || "/";
    } catch {
      /* optional */
    }
    navigate(next === "/billing" ? "/" : next);
  }
  async function upload(file?: File) {
    if (!file || uploading.current) return;
    const formats = cap.sourceFormats ?? ["epub"];
    if (!formats.some((f) => file.name.toLowerCase().endsWith(`.${f}`))) {
      setError(
        new Error(`Choose a ${formats.join(" or ").toUpperCase()} file.`),
      );
      return;
    }
    if (file.size > (cap.maxUploadBytes ?? 50 * 1024 * 1024)) {
      setError(new Error("This book exceeds the server upload limit."));
      return;
    }
    uploading.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const asset = await client.upload(file),
        book = await client.inspectBook(asset.id);
      if (!alive.current) return;
      const d: Draft = {
        id: uid(),
        book,
        originalSourceId: book.sourceId,
        title: book.title || file.name.replace(/\.[^.]+$/, ""),
        author: book.author || "",
        chapters: book.chapters.map((c) => c.id),
        narrator: voices[0]?.id || "",
        mode: "single",
        model: cap.casting?.models?.[0] || "",
        unknown: "",
        method: "gendered",
        format: cap.outputFormats?.[0] || "m4b",
        sourceCover: true,
        pauseLengths: cap.pauseLengths ? { ...defaultPauseLengths } : undefined,
        speechSettings: cap.speechSettings ? { ...defaultSpeechSettings } : undefined,
        step: 1,
        key: uid(),
        updated: Date.now(),
      };
      setLibrary((l) => ({ ...l, drafts: [d, ...l.drafts] }));
      navigate(`/drafts/${encodeURIComponent(d.id)}`);
    } catch (cause) {
      if (alive.current) setError(cause);
    } finally {
      uploading.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function created(job: JobResponse, d: Draft) {
    const record: Record = {
      id: job.id,
      sourceId: d.book.sourceId,
      title: d.title,
      author: d.author,
      narrator: d.narrator,
      sourceCover: d.sourceCover,
    };
    setLibrary((l) => ({
      drafts: l.drafts.filter((item) => item.id !== d.id),
      records: [record, ...l.records.filter((r) => r.id !== job.id)],
    }));
    setRefresh((n) => n + 1);
    navigate(`/jobs/${encodeURIComponent(job.id)}`);
  }
  const menuDraft =
    selected?.type === "draft"
      ? library.drafts.find((d) => d.id === selected.id)
      : undefined;
  const menuJob =
    selected?.type === "job"
      ? jobs?.find((j) => j.id === selected.id)
      : undefined;
  const recordFor = (job: JobResponse) =>
    library.records.find((r) => r.id === job.id);
  const metadata = (job: JobResponse) => {
    const r = recordFor(job);
    return {
      title: job.title || r?.title || "Audiobook",
      author: job.author || r?.author || "",
      sourceId: job.sourceId || r?.sourceId,
      sourceCover: (job.sourceCover ?? r?.sourceCover) !== false,
    };
  };
  const menuMeta = menuJob
    ? metadata(menuJob)
    : menuDraft
      ? {
          title: menuDraft.title,
          author: menuDraft.author,
          sourceId: menuDraft.book.sourceId,
          sourceCover: menuDraft.sourceCover,
        }
      : undefined;
  const isHome =
    !draftId && !jobId && !["/billing", "/servers"].includes(path);
  return (
    <>
      <header className="app-header">
        <button
          className="brand"
          aria-label="Kenkui Studio home"
          onClick={() => navigate("/")}
        >
          <span className="brand-mark" aria-hidden="true">
            ◖
          </span>
          Kenkui <span>Studio</span>
        </button>
        <nav className="header-actions" aria-label="Main navigation">
          <button className="text-button" onClick={() => navigate("/jobs")}>
            Your books
          </button>
          {cap.billing?.mode === "credits" && (
            <button
              className="balance-button"
              aria-label="Billing"
              onClick={billing}
            >
              ◈ {balance ?? "Billing"}
              {balance && <span className="balance-word"> credits</span>}
            </button>
          )}
          <label className="theme-label">
            <span className="sr-only">Appearance</span>
            <select
              aria-label="Appearance"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              <option value="system">◐ System</option>
              <option value="dark">☾ Dark</option>
              <option value="light">☼ Light</option>
            </select>
          </label>
          {cap.auth?.mode && cap.auth.mode !== "none" && (
            <AccountMenu client={client} signedIn initiallyOpen={path === "/sign-in"} />
          )}
        </nav>
      </header>
      <main>
        <ErrorMessage error={error} />
        {savingError && <p role="alert">{savingError}</p>}
        {path === "/billing" ? (
          <BillingPage
            client={client}
            capabilities={cap}
            onBack={backFromBilling}
            onCheckout={(url) => host.openExternal(url)}
          />

        ) : path === "/servers" && host.can.chooseServer ? (
          <ServersPage host={host} onSelect={() => window.location.reload()} />
        ) : draftId ? (
          draft ? (
            <>
              <ErrorMessage error={voiceError} />
              {voiceError && (
                <button onClick={() => setRefresh((n) => n + 1)}>
                  Retry voices
                </button>
              )}
              <Composer
                key={draft.id}
                draft={draft}
                client={client}
                capabilities={cap}
                voices={voices}
                update={update}
                onHome={() => navigate("/jobs")}
                onBilling={billing}
                onCreated={created}
              />
            </>
          ) : (
            <section>
              <h1>Draft unavailable</h1>
              <p>This draft is not saved for this account on this device.</p>
              <button className="primary" onClick={() => navigate("/")}>
                Add a book
              </button>
            </section>
          )
        ) : jobId ? (
          <JobView
            key={jobId}
            id={jobId}
            client={client}
            host={host}
            capabilities={cap}
            record={library.records.find((r) => r.id === jobId)}
            onHome={() => navigate("/jobs")}
            onChanged={() => setRefresh((n) => n + 1)}
          />
        ) : isHome ? (
          <>
            <section className="new-book">
              <div className="section-top">
                <h1>New audiobook</h1>
                <span className="quiet">
                  {(cap.sourceFormats ?? ["epub"]).join(" / ").toUpperCase()} →
                  Audio
                </span>
              </div>
              <div
                className="drop-zone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void upload(e.dataTransfer.files[0]);
                }}
              >
                <div className="upload-icon" aria-hidden="true">
                  ↥
                </div>
                <div>
                  <h2>Add your book</h2>
                  <p>Choose a book or drop it here.</p>
                </div>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  {busy ? "Reading book…" : "Choose file"}{" "}
                  <span aria-hidden="true">↗</span>
                </button>
                <input
                  ref={input}
                  aria-label={`${(cap.sourceFormats ?? ["epub"]).join(" / ").toUpperCase()} source`}
                  hidden
                  type="file"
                  accept={(cap.sourceFormats ?? ["epub"])
                    .map((f) => `.${f}`)
                    .join(",")}
                  onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
              {busy && <p role="status">Uploading and reading your book…</p>}
              <p className="quiet upload-note">
                Up to{" "}
                {Math.floor(
                  (cap.maxUploadBytes ?? 50 * 1024 * 1024) / 1024 / 1024,
                )}{" "}
                MB · Your draft is saved on this device.
              </p>
            </section>
            <section id="books" className="library">
              <div className="section-top">
                <h2>Your books</h2>
                <button
                  className="text-button"
                  onClick={() => setRefresh((n) => n + 1)}
                >
                  Refresh
                </button>
              </div>
              <ErrorMessage error={jobsError} />
              {!jobs && !jobsError && <p role="status">Loading your books…</p>}
              {jobs?.length === 0 && library.drafts.length === 0 && (
                <p className="empty">
                  Your audiobooks and unfinished drafts will appear here.
                </p>
              )}
              <div className="book-grid">
                {library.drafts.map((d) => (
                  <article key={`draft-${d.id}`}>
                    <button
                      className="book-tile"
                      aria-label={`${d.title} — Draft, open actions`}
                      onClick={() => setSelected({ type: "draft", id: d.id })}
                    >
                      <BookCover
                        title={d.title}
                        author={d.author}
                        sourceId={d.book.sourceId}
                        client={client}
                        enabled={Boolean(cap.covers?.read && d.sourceCover)}
                      />
                      <span className="status-badge">
                        <span className="status-dot" />
                        Draft
                      </span>
                    </button>
                    <p className="book-title" title={d.title}>
                      {d.title}
                    </p>
                  </article>
                ))}
                {jobs?.map((job) => {
                  const m = metadata(job);
                  return (
                    <article key={job.id}>
                      <button
                        className="book-tile"
                        aria-label={`${m.title} — ${statusLabel(job.status)}, open actions`}
                        onClick={() => setSelected({ type: "job", id: job.id })}
                      >
                        <BookCover
                          {...m}
                          client={client}
                          enabled={Boolean(cap.covers?.read && m.sourceCover)}
                        />
                        <span
                          className={`status-badge ${job.status === "succeeded" ? "ready" : job.status === "running" ? "creating" : ""}`}
                        >
                          <span className="status-dot" />
                          {statusLabel(job.status)}
                        </span>
                      </button>
                      <p className="book-title" title={m.title}>
                        {m.title}
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        ) : null}
      </main>
      <footer className="site-footer">
        <span>Kenkui Studio</span>
        <div>
          {host.can.chooseServer && (
            <button
              className="text-button"
              onClick={() => navigate("/servers")}
            >
              Server
            </button>
          )}

        </div>
      </footer>
      <dialog
        ref={dialog}
        className="book-dialog"
        aria-labelledby="book-actions-title"
        onCancel={() => setSelected(undefined)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected(undefined);
        }}
      >
        <div className="dialog-top">
          <h2 id="book-actions-title">{menuMeta?.title || "Book actions"}</h2>
          <button
            className="icon-button"
            aria-label="Close book actions"
            onClick={() => setSelected(undefined)}
          >
            ×
          </button>
        </div>
        {menuMeta && (
          <>
            <div className="menu-book">
              <BookCover
                {...menuMeta}
                client={client}
                enabled={Boolean(cap.covers?.read && menuMeta.sourceCover)}
              />
              <div>
                <span className="menu-status">
                  {menuDraft ? "Draft" : statusLabel(menuJob?.status || "")}
                </span>
                <p>{menuMeta.author}</p>
                {menuJob && (
                  <p className="quiet">
                    {menuJob.progress.stage} · {menuJob.progress.completed}/
                    {menuJob.progress.total || "?"}
                  </p>
                )}
              </div>
            </div>
            <button
              className="primary full"
              onClick={() =>
                navigate(
                  menuDraft
                    ? `/drafts/${encodeURIComponent(menuDraft.id)}`
                    : `/jobs/${encodeURIComponent(menuJob!.id)}`,
                )
              }
            >
              {menuDraft
                ? "Continue setup"
                : menuJob?.status === "succeeded"
                  ? "Listen & download"
                  : "View conversion"}
            </button>
            {menuDraft && (
              <button
                className="text-button"
                onClick={() => {
                  setLibrary((l) => ({
                    ...l,
                    drafts: l.drafts.filter((d) => d.id !== menuDraft.id),
                  }));
                  setSelected(undefined);
                }}
              >
                Discard draft
              </button>
            )}
          </>
        )}
      </dialog>
    </>
  );
}
