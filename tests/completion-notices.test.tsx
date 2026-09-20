import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { JobResponse } from "../src/api/generated/v1";
import { useCompletionNotices } from "../src/studio/completion-notices";
import { fakeHost, fakeNotifications } from "./fakes/host";

const job = (id: string, status: string, title?: string) =>
  ({ id, status, progress: { stage: "synthesis", completed: 1, total: 1 }, title } as JobResponse);

function Watcher({ jobs, host, titles = {} }: {
  jobs?: JobResponse[];
  host: ReturnType<typeof fakeHost>;
  titles?: Record<string, string>;
}) {
  useCompletionNotices(jobs, host, (id) => titles[id]);
  return null;
}

describe("completion notices", () => {
  test("a book that finished before this tab opened is not announced", () => {
    const notifications = fakeNotifications();
    const host = fakeHost({ notifications });
    render(<Watcher jobs={[job("a", "succeeded")]} host={host} />);
    expect(notifications.shown).toEqual([]);
  });

  test("finishing while the studio is open announces the book by name", () => {
    const notifications = fakeNotifications();
    const host = fakeHost({ notifications });
    const view = render(<Watcher jobs={[job("a", "running")]} host={host} titles={{ a: "Middlemarch" }} />);
    view.rerender(<Watcher jobs={[job("a", "succeeded")]} host={host} titles={{ a: "Middlemarch" }} />);
    expect(notifications.shown).toEqual([
      {
        title: "“Middlemarch” is ready",
        body: "Narration finished. Open Kenkui Studio to download it.",
        path: "/jobs/a",
      },
    ]);
  });

  test("the job's own title wins over a locally remembered one", () => {
    const notifications = fakeNotifications();
    const host = fakeHost({ notifications });
    const view = render(<Watcher jobs={[job("a", "running", "Server Title")]} host={host} titles={{ a: "Local" }} />);
    view.rerender(<Watcher jobs={[job("a", "succeeded", "Server Title")]} host={host} titles={{ a: "Local" }} />);
    expect(notifications.shown[0].title).toBe("“Server Title” is ready");
  });

  test("an untitled book still announces itself", () => {
    const notifications = fakeNotifications();
    const host = fakeHost({ notifications });
    const view = render(<Watcher jobs={[job("a", "running")]} host={host} />);
    view.rerender(<Watcher jobs={[job("a", "succeeded")]} host={host} />);
    expect(notifications.shown[0].title).toBe("Your audiobook is ready");
  });

  test.each(["failed", "cancelled"])("a %s job is not a completion", (status) => {
    const notifications = fakeNotifications();
    const host = fakeHost({ notifications });
    const view = render(<Watcher jobs={[job("a", "running")]} host={host} />);
    view.rerender(<Watcher jobs={[job("a", status)]} host={host} />);
    expect(notifications.shown).toEqual([]);
  });

  test("a repeated snapshot announces the same book only once", () => {
    const notifications = fakeNotifications();
    const host = fakeHost({ notifications });
    const view = render(<Watcher jobs={[job("a", "running")]} host={host} />);
    view.rerender(<Watcher jobs={[job("a", "succeeded")]} host={host} />);
    view.rerender(<Watcher jobs={[job("a", "succeeded")]} host={host} />);
    expect(notifications.shown).toHaveLength(1);
  });

  test("a job first seen already finished is not announced", () => {
    const notifications = fakeNotifications();
    const host = fakeHost({ notifications });
    const view = render(<Watcher jobs={[job("a", "running")]} host={host} />);
    view.rerender(<Watcher jobs={[job("a", "running"), job("b", "succeeded")]} host={host} />);
    expect(notifications.shown).toEqual([]);
  });

  test("a host without notifications simply stays quiet", () => {
    const host = fakeHost();
    const view = render(<Watcher jobs={[job("a", "running")]} host={host} />);
    expect(() =>
      view.rerender(<Watcher jobs={[job("a", "succeeded")]} host={host} />),
    ).not.toThrow();
  });
});
