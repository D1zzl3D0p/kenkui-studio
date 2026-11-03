import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { JobView } from "../src/studio/job-view";
import { App } from "../src/app";
import { fakeHost } from "./fakes/host";
import type { KenkuiServerClient } from "../src/api/client";
const cap = { apiVersion: "1", auth: { mode: "none" } } as const;
function snapshot(status: string) {
  return {
    id: "book",
    status,
    progress: { stage: "audio", completed: 1, total: 3 },
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it.each(["failed", "cancelled", "succeeded"])(
  "stops all fallback requests for %s",
  async (status) => {
    vi.useFakeTimers();
    const getJob = vi
      .fn()
      .mockResolvedValueOnce(snapshot("running"))
      .mockResolvedValue(snapshot(status));
    const events = vi.fn(() => {
      throw Error("no SSE");
    });
    render(
      <JobView
        id="book"
        client={{ getJob, events } as unknown as KenkuiServerClient}
        host={fakeHost()}
        capabilities={cap}
        onHome={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    await act(() => vi.advanceTimersByTimeAsync(60000));
    expect(getJob).toHaveBeenCalledTimes(2);
  },
);
it("closes a hidden stream and fetches one snapshot on return", async () => {
  vi.useFakeTimers();
  let visible = true,
    resume = () => {};
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    visible ? "visible" : "hidden",
  );
  const close = vi.fn(),
    events = vi.fn(() => ({
      close,
      onDisconnect: vi.fn().mockResolvedValue(snapshot("running")),
    }));
  const getJob = vi.fn().mockResolvedValue(snapshot("running"));
  render(
    <JobView
      id="book"
      client={{ getJob, events } as unknown as KenkuiServerClient}
      host={fakeHost({
        onResume: (fn) => {
          resume = fn;
          return () => {};
        },
      })}
      capabilities={cap}
      onHome={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  visible = false;
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(close).toHaveBeenCalledOnce();
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(getJob).toHaveBeenCalledOnce();
  visible = true;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    resume();
  });
  expect(getJob).toHaveBeenCalledTimes(2);
  expect(events).toHaveBeenCalledTimes(2);
});
it("lets an empty library go idle", async () => {
  vi.useFakeTimers();
  const jobs = vi.fn().mockResolvedValue({ items: [] });
  const api = {
    storageScope: () => "same-origin",
    capabilities: async () => cap,
    jobs,
    voices: async () => ({ items: [] }),
  };
  render(
    <App client={api as unknown as KenkuiServerClient} host={fakeHost()} />,
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  await act(() => vi.advanceTimersByTimeAsync(90000));
  expect(jobs).toHaveBeenCalledOnce();
});

it("pauses checkout confirmation while hidden and keeps its original deadline", async () => {
  const { BillingPage } = await import("../src/pages/billing");
  vi.useFakeTimers();
  window.history.replaceState({}, "", "/billing?checkout=success");
  const billing = vi.fn().mockResolvedValue({
    availableCredits: "400",
    creditHistoryAvailable: true,
  });
  const creditHistory = vi.fn().mockResolvedValue({ items: [] });
  let visible = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    visible ? "visible" : "hidden",
  );
  try {
    render(
      <BillingPage
        capabilities={{ ...cap, billing: { mode: "credits" } }}
        client={{ billing, creditHistory } as unknown as KenkuiServerClient}
      />,
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    visible = false;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(() => vi.advanceTimersByTimeAsync(57000));
    expect(billing).toHaveBeenCalledOnce();
    expect(creditHistory).toHaveBeenCalledOnce();
    visible = true;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(billing).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    const calls = billing.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(60000));
    expect(billing).toHaveBeenCalledTimes(calls);
  } finally {
    window.history.replaceState({}, "", "/");
  }
});

it.each([404, 503])(
  "bounds automatic retries after an initial HTTP %s",
  async (status) => {
    vi.useFakeTimers();
    const { KenkuiApiError } = await import("../src/api/errors");
    const getJob = vi
      .fn()
      .mockRejectedValue(new KenkuiApiError(status, "Unavailable"));
    const view = render(
      <JobView
        id="book"
        client={{ getJob } as unknown as KenkuiServerClient}
        host={fakeHost()}
        capabilities={cap}
        onHome={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    await act(() => vi.advanceTimersByTimeAsync(3600000));
    expect(getJob).toHaveBeenCalledTimes(status === 404 ? 1 : 4);
    expect(view.getByRole("button", { name: /retry|refresh/i })).toBeVisible();
  },
);
it("clears a transient job error after the next successful snapshot", async () => {
  vi.useFakeTimers();
  const getJob = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValue(snapshot("succeeded"));
  const view = render(
    <JobView
      id="book"
      client={{ getJob } as unknown as KenkuiServerClient}
      host={fakeHost()}
      capabilities={cap}
      onHome={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(getJob).toHaveBeenCalledTimes(2);
  expect(view.queryByRole("alert")).toBeNull();
});
it("resumes tracking a known active library after a transient list failure then stops", async () => {
  vi.useFakeTimers();
  const { KenkuiApiError } = await import("../src/api/errors");
  const jobs = vi
    .fn()
    .mockResolvedValueOnce({ items: [snapshot("running")] })
    .mockRejectedValueOnce(new KenkuiApiError(503, "Temporary"))
    .mockResolvedValue({ items: [snapshot("succeeded")] });
  const api = {
    storageScope: () => "same-origin",
    capabilities: async () => cap,
    jobs,
    voices: async () => ({ items: [] }),
  };
  const view = render(
    <App client={api as unknown as KenkuiServerClient} host={fakeHost()} />,
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  await act(() => vi.advanceTimersByTimeAsync(120000));
  expect(jobs).toHaveBeenCalledTimes(3);
  expect(view.queryByRole("alert")).toBeNull();
});

it.each([404, 503])(
  "stops library retries after a permanent or repeatedly failing response (%s)",
  async (status) => {
    vi.useFakeTimers();
    const { KenkuiApiError } = await import("../src/api/errors");
    const jobs = vi
      .fn()
      .mockResolvedValueOnce({ items: [snapshot("running")] })
      .mockRejectedValue(new KenkuiApiError(status, "Failed list"));
    const api = {
      storageScope: () => "same-origin",
      capabilities: async () => cap,
      jobs,
      voices: async () => ({ items: [] }),
    };
    render(
      <App client={api as unknown as KenkuiServerClient} host={fakeHost()} />,
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(3600000));
    expect(jobs).toHaveBeenCalledTimes(status === 404 ? 2 : 5);
  },
);
