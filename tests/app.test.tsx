import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app";
import { KenkuiApiError } from "../src/api/errors";
import { fakeHost } from "./fakes/host";
import {
  requestFor,
  pauseLengthsFor,
  defaultSpeechSettings,
  changeDraft,
  readLibrary,
  type Draft,
} from "../src/studio/store";
const capabilities = {
  apiVersion: "1",
  auth: { mode: "none" },
  billing: { mode: "unmetered" },
  casting: { modes: ["single"], models: [] },
  outputFormats: ["m4b"],
  sourceFormats: ["epub"],
};
function makeClient<T extends object = {}>(extra: T = {} as T) {
  return {
    storageScope: () => "test-server",
    capabilities: vi.fn().mockResolvedValue(capabilities),
    upload: vi
      .fn()
      .mockResolvedValue({ id: "asset-1", format: "epub", sha256: "hash" }),
    inspectBook: vi.fn().mockResolvedValue({
      sourceId: "asset-1",
      title: "Book",
      author: "Author",
      chapters: [
        { id: "stable-chapter", title: "Chapter one", speechCharacters: 42_000 },
        { id: "second", title: "Chapter two", speechCharacters: 500_000 },
      ],
    }),
    voices: vi.fn().mockResolvedValue({
      items: [{ id: "voice-1", name: "Narrator", language: "en" }],
    }),
    preflight: vi.fn().mockResolvedValue({
      sourceId: "asset-1",
      normalizedCharacters: 42,
      valid: true,
    }),
    createJob: vi.fn().mockResolvedValue({
      id: "job-1",
      status: "queued",
      progress: { stage: "queued", completed: 0, total: 1 },
    }),
    getJob: vi.fn().mockResolvedValue({
      id: "job-1",
      status: "running",
      progress: { stage: "synthesis", completed: 1, total: 2 },
    }),
    cancelJob: vi.fn().mockResolvedValue({
      id: "job-1",
      status: "cancel_requested",
      progress: { stage: "cancelling", completed: 1, total: 2 },
    }),
    jobs: vi.fn().mockResolvedValue({ items: [] }),
    events: vi.fn().mockReturnValue({
      close: vi.fn(),
      onDisconnect: vi.fn().mockResolvedValue(undefined),
    }),
    billing: vi
      .fn()
      .mockResolvedValue({ availableCredits: "500", checkoutEnabled: "false" }),
    session: vi.fn().mockResolvedValue({ userId: "person-a" }),
    ...extra,
  };
}
beforeEach(() => {
  window.history.replaceState({}, "", "/");
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
async function upload() {
  const input = await screen.findByLabelText("EPUB source");
  fireEvent.change(input, {
    target: {
      files: [
        new File(["epub"], "book.epub", { type: "application/epub+zip" }),
      ],
    },
  });
  await screen.findByRole("heading", { name: "Book details" });
}
async function review() {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Narration" });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Review & create" });
}

describe("real creation flow", () => {
  it("uses stable chapter IDs, preflights before creation, and preserves the request key on retry", async () => {
    const client = makeClient();
    client.createJob.mockRejectedValueOnce(
      new TypeError("Network unavailable"),
    );
    render(<App client={client as never} host={fakeHost()} />);
    await upload();
    fireEvent.click(screen.getByText("Advanced", { exact: true }));
    fireEvent.click(screen.getByLabelText("Chapter two"));
    await review();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create audiobook" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create audiobook" }));
    await screen.findByText("Network unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Create audiobook" }));
    await screen.findByRole("heading", { name: "Creating your audiobook" });
    expect(client.createJob.mock.calls[0][0]).toMatchObject({
      chapters: ["stable-chapter"],
      casting: { voiceId: "voice-1" },
    });
    expect(client.createJob.mock.calls[0][1]).toBe(
      client.createJob.mock.calls[1][1],
    );
    expect(client.preflight.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it("saves and resumes the draft without uploading the source again", async () => {
    const client = makeClient();
    const mounted = render(<App client={client as never} host={fakeHost()} />);
    await upload();
    fireEvent.change(screen.getByLabelText("Title", { exact: true }), {
      target: { value: "My book" },
    });
    mounted.unmount();
    window.history.replaceState({}, "", "/");
    render(<App client={client as never} host={fakeHost()} />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "My book — Draft, open actions",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue setup" }));
    expect(await screen.findByDisplayValue("My book")).toBeVisible();
    expect(client.upload).toHaveBeenCalledTimes(1);
  });
  it("isolates saved drafts by server and signed-in account", async () => {
    const client = makeClient({
      capabilities: vi
        .fn()
        .mockResolvedValue({ ...capabilities, auth: { mode: "session" } }),
    });
    const mounted = render(<App client={client as never} host={fakeHost()} />);
    await upload();
    mounted.unmount();
    window.history.replaceState({}, "", "/");
    client.session.mockResolvedValue({ userId: "person-b" });
    render(<App client={client as never} host={fakeHost()} />);
    await screen.findByText(
      "Your audiobooks and unfinished drafts will appear here.",
    );
    expect(screen.queryByRole("button", { name: /Book — Draft/ })).toBeNull();
  });
  it("submits server-supported full cast with model and fallback settings", async () => {
    const client = makeClient({
      capabilities: vi.fn().mockResolvedValue({
        ...capabilities,
        casting: {
          modes: ["single", "characters"],
          models: ["allowed-model"],
        },
      }),
    });
    render(<App client={client as never} host={fakeHost()} />);
    await upload();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: /Full cast/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create audiobook" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create audiobook" }));
    await waitFor(() => expect(client.createJob).toHaveBeenCalled());
    expect(client.createJob.mock.calls[0][0].casting).toEqual({
      narratorVoiceId: "voice-1",
      unknownVoiceId: "voice-1",
      modelId: "allowed-model",
      method: "gendered",
    });
  });

});

describe("server quotes and billing", () => {
  const priced = { ...capabilities, billing: { mode: "credits" } };
  it("blocks insufficient funds and never submits", async () => {
    const client = makeClient({
      capabilities: vi.fn().mockResolvedValue(priced),
      preflight: vi.fn().mockResolvedValue({
        sourceId: "asset-1",
        normalizedCharacters: 42,
        valid: false,
        estimatedCredits: 200,
        availableCredits: 100,
      }),
    });
    render(<App client={client as never} host={fakeHost()} />);
    await upload();
    await review();
    await screen.findByText(
      "You do not have enough credits for this book conversion.",
    );
    expect(
      screen.getByRole("button", { name: "Create · 200 credits" }),
    ).toBeDisabled();
    expect(client.createJob).not.toHaveBeenCalled();
  });
  it("requires a second confirmation if the server price changes at submission", async () => {
    const client = makeClient({
      capabilities: vi.fn().mockResolvedValue(priced),
      preflight: vi.fn().mockResolvedValue({
        sourceId: "asset-1",
        normalizedCharacters: 42,
        valid: true,
        estimatedCredits: 100,
        availableCredits: 500,
      }),
    });
    render(<App client={client as never} host={fakeHost()} />);
    await upload();
    await review();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create · 100 credits" }),
      ).toBeEnabled(),
    );
    client.preflight.mockResolvedValue({
      sourceId: "asset-1",
      normalizedCharacters: 42,
      valid: true,
      estimatedCredits: 150,
      availableCredits: 500,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create · 100 credits" }),
    );
    await screen.findByText(
      "The price has changed. Review the updated estimate and confirm again.",
    );
    expect(client.createJob).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Create · 150 credits" }),
    );
    await waitFor(() => expect(client.createJob).toHaveBeenCalledOnce());
  });
  it("invalidates the displayed quote immediately on setting change, abandons it, and ignores late results", async () => {
    let oldResolve: (v: unknown) => void = () => {};
    const client = makeClient({
      capabilities: vi.fn().mockResolvedValue(priced),
      preflight: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              oldResolve = resolve;
            }),
        )
        .mockResolvedValue({
          sourceId: "asset-1",
          normalizedCharacters: 20,
          valid: true,
          estimatedCredits: 50,
          availableCredits: 500,
        }),
    });
    render(<App client={client as never} host={fakeHost()} />);
    await upload();
    await waitFor(() => expect(client.preflight).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByText("Advanced", { exact: true }));
    fireEvent.click(screen.getByLabelText("Chapter two"));
    await screen.findByText("50 credits");
    expect(client.preflight.mock.calls[0][1].aborted).toBe(true);
    await act(async () =>
      oldResolve({
        sourceId: "asset-1",
        normalizedCharacters: 42,
        valid: true,
        estimatedCredits: 100,
        availableCredits: 500,
      }),
    );
    expect(screen.queryByText("100 credits")).toBeNull();
    expect(screen.getByText("50 credits")).toBeVisible();
  });
  it("sizes every chapter and flags the unusually long one", async () => {
    const client = makeClient({
      capabilities: vi.fn().mockResolvedValue({
        ...capabilities,
        narration: { charactersPerSecond: 13, longChapterHours: 6 },
      }),
    });
    render(<App client={client as never} host={fakeHost()} />);
    await upload();
    fireEvent.click(screen.getByText("Advanced", { exact: true }));

    // 42,000 characters at 13 per second is under an hour; 500,000 is over ten.
    await screen.findByText("42,000 characters · about 54 min");
    const long = screen.getByText(
      "500,000 characters · about 10 h 41 m · unusually long",
    );
    expect(long).toBeVisible();
    expect(long.className).toContain("long");
    // Naming the input keeps the control readable beside its size.
    expect(screen.getByLabelText("Chapter two")).toBeChecked();
  });
  it("does not fetch billing on an unmetered server", async () => {
    const client = makeClient();
    render(
      <App client={client as never} host={fakeHost()} initialPath="/billing" />,
    );
    await screen.findByText("Billing is unavailable on this server.");
    expect(client.billing).not.toHaveBeenCalled();
  });
});

describe("job lifecycle and host behavior", () => {
  it.each(["button", "unmount"])("shows download progress and cancels via %s", async (cancelVia) => {
    const host = fakeHost();
    host.can.saveToPath = true;
    let signal!: AbortSignal;
    vi.mocked(host.saveArtifact).mockImplementation((_artifact, _name, options) => new Promise((_resolve, reject) => {
      signal = options!.signal!;
      options!.onProgress!({ received: 1048576, total: 2097152 });
      signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    }));
    const client = makeClient({
      getJob: vi.fn().mockResolvedValue({ id: "job-1", status: "succeeded", progress: { stage: "complete", completed: 1, total: 1 } }),
      artifactUrl: vi.fn().mockReturnValue("/v1/jobs/job-1/artifact"),
    });
    const view = render(<App client={client as never} host={host} initialPath="/jobs/job-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Download M4B" }));
    expect(await screen.findByText("Downloaded 1.0 MB of 2.0 MB")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Download progress" })).toHaveAttribute("value", "1048576");
    if (cancelVia === "unmount") view.unmount();
    else fireEvent.click(screen.getByRole("button", { name: "Cancel download" }));
    expect(signal.aborted).toBe(true);
    if (cancelVia === "button") {
      await waitFor(() => expect(screen.getByRole("button", { name: "Download M4B" })).toBeEnabled());
      expect(screen.queryByRole("alert")).toBeNull();
    }
  });
  it("keeps cancellation pending and enables real host download only at completion", async () => {
    let emit: (event: any) => void = () => {};
    const host = fakeHost();
    const client = makeClient({
      events: vi.fn((_: string, fn: typeof emit) => {
        emit = fn;
        return { close: vi.fn(), onDisconnect: vi.fn() };
      }),
      artifactUrl: vi.fn().mockReturnValue("/v1/jobs/job-1/artifact"),
      artifact: vi.fn().mockResolvedValue(new Blob(["audio"])),
    });
    render(
      <App client={client as never} host={host} initialPath="/jobs/job-1" />,
    );
    await screen.findByText("Status: running");
    fireEvent.click(screen.getByRole("button", { name: "Cancel conversion" }));
    await screen.findByText("Status: Cancellation requested");
    expect(
      screen.getByRole("button", { name: "Cancel conversion" }),
    ).toBeDisabled();
    client.getJob.mockResolvedValue({
      id: "job-1",
      status: "succeeded",
      progress: { stage: "complete", completed: 2, total: 2 },
    });
    act(() =>
      emit({
        type: "completed",
        progress: { stage: "complete", completed: 2, total: 2 },
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Download M4B" }),
    );
    await waitFor(() =>
      expect(host.saveArtifact).toHaveBeenCalledWith(
        { url: "/v1/jobs/job-1/artifact", load: expect.any(Function) },
        "Audiobook.m4b",
        expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) }),
      ),
    );
    expect(client.artifact).not.toHaveBeenCalled();
    await vi.mocked(host.saveArtifact).mock.calls[0][0].load();
    expect(client.artifact).toHaveBeenCalledWith("job-1");
  });
  it("recovers after returning to the foreground", async () => {
    let resume = () => {};
    const client = makeClient(),
      host = fakeHost({
        onResume: (fn) => {
          resume = fn;
          return () => {};
        },
      });
    render(
      <App client={client as never} host={host} initialPath="/jobs/job-1" />,
    );
    await screen.findByText("Status: running");
    act(() => resume());
    await waitFor(() => expect(client.getJob).toHaveBeenCalledTimes(2));
  });
  it("allows changing servers while the current one is unreachable", async () => {
    const client = makeClient({
      capabilities: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const host = fakeHost({
      can: {
        chooseServer: true,
        reachLoopback: true,
        manageLocalServer: false,
        saveToPath: true,
      },
    });
    render(<App client={client as never} host={host} />);
    await screen.findByText("offline");
    fireEvent.click(
      screen.getByRole("button", { name: "Choose another server" }),
    );
    await screen.findByRole("heading", { name: /server/i });
  });
});

it("changes request idempotency only for semantic changes", () => {
  const d: Draft = {
    id: "draft",
    book: { sourceId: "source", title: "Book", author: "A", chapters: [] },
    originalSourceId: "source",
    title: "Book",
    author: "A",
    chapters: ["c"],
    narrator: "v",
    mode: "single",
    model: "",
    unknown: "",
    method: "gendered",
    format: "m4b",
    sourceCover: true,
    step: 1,
    key: "same",
    updated: 1,
  };
  expect(changeDraft(d, { step: 2 }).key).toBe("same");
  expect(changeDraft(d, { title: "New" }).key).not.toBe("same");
  expect(requestFor(d).casting).toEqual({ voiceId: "v" });
  localStorage.setItem("broken", "{}");
  expect(readLibrary("broken")).toEqual({ drafts: [], records: [] });
});

describe("existing Studio feature parity", () => {
  it("keeps job IDs and the last stage available after a failed conversion", async () => {
    const client = makeClient({
      getJob: vi.fn().mockResolvedValue({
        id: "job-1",
        status: "failed",
        progress: { stage: "synthesis", completed: 2, total: 5 },
        failure: { message: "Voice service unavailable" },
      }),
    });
    render(
      <App
        client={client as never}
        host={fakeHost()}
        initialPath="/jobs/job-1"
      />,
    );
    await screen.findByText("Voice service unavailable");
    fireEvent.click(screen.getByText("Conversion details"));
    expect(screen.getByText("job-1")).toBeVisible();
    expect(screen.getByText("Stage: synthesis")).toBeVisible();
    expect(screen.getByText("2 of 5 items")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Cancel conversion" }),
    ).toBeNull();
  });
  it("preserves metadata, cover preference, casting method, model and output format", async () => {
    const client = makeClient({
      voices: vi.fn().mockResolvedValue({
        items: [
          { id: "voice-1", name: "Narrator", language: "en" },
          { id: "voice-2", name: "Second voice", language: "en" },
        ],
      }),
      capabilities: vi.fn().mockResolvedValue({
        ...capabilities,
        outputFormats: ["m4b", "mp3"],
        casting: {
          modes: ["single", "characters"],
          models: ["first-model", "second-model"],
        },
      }),
    });
    render(<App client={client as never} host={fakeHost()} />);
    await upload();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Edited title" },
    });
    fireEvent.change(screen.getByLabelText("Author"), {
      target: { value: "Edited author" },
    });
    fireEvent.click(screen.getByText("Advanced"));
    fireEvent.click(screen.getByLabelText("Include book cover"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: /Full cast/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Choose fallback voice" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Second voice/ }));
    fireEvent.click(screen.getByRole("button", { name: "Use voice" }));
    fireEvent.click(screen.getByText("Advanced"));
    fireEvent.change(screen.getByLabelText("Voice assignment"), {
      target: { value: "random" },
    });
    fireEvent.change(screen.getByLabelText("Character analysis model"), {
      target: { value: "second-model" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByText("Advanced"));
    fireEvent.change(screen.getByLabelText("Audio format"), {
      target: { value: "mp3" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create audiobook" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create audiobook" }));
    await waitFor(() => expect(client.createJob).toHaveBeenCalled());
    expect(client.createJob.mock.calls[0][0]).toMatchObject({
      casting: {
        narratorVoiceId: "voice-1",
        unknownVoiceId: "voice-2",
        modelId: "second-model",
        method: "random",
      },
      tts: { normalizeText: true },
      output: {
        title: "Edited title",
        author: "Edited author",
        sourceCover: false,
        format: "mp3",
      },
    });
  });
  it("offers the existing sign-in flow when the session has expired", async () => {
    const client = makeClient({
      capabilities: vi
        .fn()
        .mockResolvedValue({ ...capabilities, auth: { mode: "session" } }),
      session: vi.fn().mockRejectedValue(new Error("Session expired")),
      authUrl: (action: string) => `/v1/auth/${action}`,
    });
    render(<App client={client as never} host={fakeHost()} />);
    expect(
      await screen.findByRole("link", { name: "Sign in" }),
    ).toHaveAttribute("href", "/v1/auth/login");
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

it("returns from billing to a full-cast draft and checks the replenished balance before creation", async () => {
  const client = makeClient({
    capabilities: vi.fn().mockResolvedValue({ ...capabilities,
      billing: { mode: "credits" },
      casting: { modes: ["single", "characters"], models: ["allowed-model"] },
    }),
    preflight: vi.fn().mockResolvedValue({ sourceId: "asset-1", normalizedCharacters: 42,
      valid: false, estimatedCredits: 150, availableCredits: 0 }),
    billing: vi.fn().mockResolvedValue({ availableCredits: "0", checkoutEnabled: "true" }),
    checkout: vi.fn().mockResolvedValue({ url: "https://checkout.stripe.com/test" }),
  });
  const host = fakeHost();
  render(<App client={client as never} host={host} />);
  await upload();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByRole("button", { name: /Full cast/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("You do not have enough credits for this book conversion.");
  expect(screen.getByRole("button", { name: "Create · 150 credits" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Add credits" }));
  fireEvent.click(await screen.findByRole("button", { name: "Buy 500 credits — $5 USD" }));
  await waitFor(() => expect(host.openExternal).toHaveBeenCalledWith("https://checkout.stripe.com/test"));
  client.preflight.mockResolvedValue({ sourceId: "asset-1", normalizedCharacters: 42,
    valid: true, estimatedCredits: 150, availableCredits: 500 });
  client.billing.mockResolvedValue({ availableCredits: "500", checkoutEnabled: "true" });
  fireEvent.click(screen.getByRole("button", { name: /Back to your book/ }));
  await screen.findByRole("heading", { name: "Review & create" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Create · 150 credits" })).toBeEnabled());
  const beforeSubmit = client.preflight.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Create · 150 credits" }));
  await waitFor(() => expect(client.createJob).toHaveBeenCalledTimes(1));
  expect(client.preflight).toHaveBeenCalledTimes(beforeSubmit + 1);
  expect(client.createJob.mock.calls[0][0].casting).toEqual({
    narratorVoiceId: "voice-1", unknownVoiceId: "voice-1", modelId: "allowed-model", method: "gendered",
  });
  expect(client.upload).toHaveBeenCalledTimes(1);
});

it("moves signed-in account actions into the header and dismisses them with Escape", async () => {
  const client = makeClient({
    capabilities: vi.fn().mockResolvedValue({ ...capabilities, auth: { mode: "session" } }),
    session: vi.fn().mockResolvedValue({ userId: "reader" }),
    authUrl: (action: string) => `/v1/auth/${action}`,
  });
  render(<App client={client as never} host={fakeHost()} initialPath="/sign-in" />);
  const account = await screen.findByRole("button", { name: "Account" });
  expect(account.closest("header")).not.toBeNull();
  expect(await screen.findByRole("heading", { name: "New audiobook" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Sign out" }).closest("form")).toHaveAttribute("method", "post");
  expect(screen.getByRole("button", { name: "Sign out" }).closest("form")).toHaveAttribute("action", "/v1/auth/logout");
  expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(account).toHaveAttribute("aria-expanded", "false");
  expect(account).toHaveFocus();
  fireEvent.click(account);
  expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
});

it("offers only sign-in actions when the session is unavailable", async () => {
  const client = makeClient({
    capabilities: vi.fn().mockResolvedValue({ ...capabilities, auth: { mode: "session" } }),
    session: vi.fn().mockRejectedValue(new Error("Session expired")),
    authUrl: (action: string) => `/v1/auth/${action}`,
  });
  render(<App client={client as never} host={fakeHost()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Account" }));
  expect(screen.getAllByRole("link", { name: "Sign in" })).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
});


describe("pacing and speech preparation", () => {
  it("persists defaults and overrides and submits the same settings it estimates", async () => {
    const client = makeClient({ capabilities: vi.fn().mockResolvedValue({ ...capabilities, speechSettings: true, pauseLengths: true }) });
    const mounted = render(<App client={client as never} host={fakeHost()} />);
    await upload();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Narration" });
    expect(screen.getByLabelText("Between chapters (ms)")).toHaveValue("1500");
    expect(screen.getByLabelText("Prepare numbers for narration")).toBeChecked();
    expect(screen.getByLabelText("Use pronunciation corrections")).toBeChecked();
    expect(screen.getByLabelText("Improve stuttered dialogue")).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("Between chapters (ms)"), { target: { value: "2300" } });
    fireEvent.change(screen.getByLabelText("After headings (ms)"), { target: { value: "650" } });
    fireEvent.change(screen.getByLabelText("Between lines (ms)"), { target: { value: "60001" } });
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByLabelText("Between lines (ms)")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByLabelText("Between lines (ms)"), { target: { value: "0" } });
    fireEvent.click(screen.getByLabelText("Prepare numbers for narration"));
    fireEvent.click(screen.getByLabelText("Improve stuttered dialogue"));
    mounted.unmount();
    render(<App client={client as never} host={fakeHost()} />);
    await screen.findByRole("heading", { name: "Narration" });
    expect(screen.getByLabelText("Between chapters (ms)")).toHaveValue("2300");
    expect(screen.getByLabelText("After headings (ms)")).toHaveValue("650");
    expect(screen.getByLabelText("Improve stuttered dialogue")).toBeChecked();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create audiobook" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Create audiobook" }));
    await screen.findByRole("heading", { name: "Creating your audiobook" });
    const payload = client.createJob.mock.calls[0][0];
    expect(payload.tts).toEqual({ normalizeText: true, chapterPauses: true, prepareNumbers: false, pronunciationCorrections: true, stutterHandling: true, chapterPauseMs: 2300, headingBeforePauseMs: 0, headingAfterPauseMs: 650, paragraphPauseMs: 0, linePauseMs: 0 });
    expect(client.preflight).toHaveBeenLastCalledWith(payload);
  });

  it("offers the scene tier only where the server applies it, and sends what it shows", async () => {
    const client = makeClient({
      capabilities: vi.fn().mockResolvedValue({
        ...capabilities, speechSettings: true, pauseLengths: true, scenePauses: true,
      }),
    });
    render(<App client={client as never} host={fakeHost()} />);
    await upload();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Narration" });
    expect(screen.getByLabelText("Between scenes (ms)")).toHaveValue("0");
    fireEvent.change(screen.getByLabelText("Between scenes (ms)"), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create audiobook" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Create audiobook" }));
    await screen.findByRole("heading", { name: "Creating your audiobook" });
    expect(client.createJob.mock.calls[0][0].tts.scenePauseMs).toBe(900);
  });

  it("hides the scene tier on a server that would ignore it", async () => {
    const client = makeClient({
      capabilities: vi.fn().mockResolvedValue({
        ...capabilities, speechSettings: true, pauseLengths: true,
      }),
    });
    render(<App client={client as never} host={fakeHost()} />);
    await upload();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Narration" });
    expect(screen.getByLabelText("Between chapters (ms)")).toHaveValue("1500");
    expect(screen.queryByLabelText("Between scenes (ms)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create audiobook" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Create audiobook" }));
    await screen.findByRole("heading", { name: "Creating your audiobook" });
    expect(client.createJob.mock.calls[0][0].tts).not.toHaveProperty("scenePauseMs");
  });

  it("does not offer new settings on older servers", async () => {
    render(<App client={makeClient() as never} host={fakeHost()} />);
    await upload();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Narration" });
    expect(screen.queryByLabelText("Pause between chapters")).toBeNull();
    expect(screen.queryByLabelText("Prepare numbers for narration")).toBeNull();
  });
});


it("keeps drafts saved before the scene tier existed", () => {
  const saved = {
    id: "draft", book: { sourceId: "source", title: "Book", author: "A", chapters: [] },
    originalSourceId: "source", title: "Book", author: "A", chapters: ["c"],
    narrator: "v", mode: "single", model: "", unknown: "", method: "gendered",
    format: "m4b", sourceCover: true, step: 1, key: "same", updated: 1,
    pauseLengths: {
      chapterPauseMs: "1500", headingBeforePauseMs: "0", headingAfterPauseMs: "0",
      paragraphPauseMs: "250", linePauseMs: "0",
    },
  };
  localStorage.setItem("old", JSON.stringify({ drafts: [saved], records: [] }));
  const [draft] = readLibrary("old").drafts;
  expect(draft).toBeDefined();
  expect(pauseLengthsFor(draft)).toEqual({
    chapterPauseMs: "1500", scenePauseMs: "0", headingBeforePauseMs: "0",
    headingAfterPauseMs: "0", paragraphPauseMs: "250", linePauseMs: "0",
  });
  expect(requestFor(draft).tts).toMatchObject({ chapterPauseMs: 1500, scenePauseMs: 0 });
});

it("preserves old chapter-pause choices when opening the duration fields", () => {
  expect(pauseLengthsFor({}).chapterPauseMs).toBe("0");
  expect(pauseLengthsFor({ speechSettings: defaultSpeechSettings }).chapterPauseMs).toBe("1500");
  expect(pauseLengthsFor({ speechSettings: { ...defaultSpeechSettings, chapterPauses: false } }).chapterPauseMs).toBe("0");
});
