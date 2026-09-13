import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { App } from "../src/app";
import { fakeHost } from "./fakes/host";

const client = {
  capabilities: vi.fn().mockResolvedValue({ apiVersion: "1", auth: { mode: "none" }, billing: { mode: "unmetered" }, casting: { modes: ["single"] }, outputFormats: ["m4b"], sourceFormats: ["epub"] }),
  upload: vi.fn().mockResolvedValue({ id: "asset-1", format: "epub", sha256: "hash" }),
  inspectBook: vi.fn().mockResolvedValue({ sourceId: "asset-1", title: "Book", author: "Author", chapters: [{ id: "stable-chapter", title: "Chapter 1" }] }),
  voices: vi.fn().mockResolvedValue({ items: [{ id: "voice-1", name: "Narrator", language: "en" }] }),
  preflight: vi.fn().mockResolvedValue({ sourceId: "asset-1", normalizedCharacters: 42, valid: true }),
  createJob: vi.fn().mockResolvedValue({ id: "job-1", status: "queued", progress: { stage: "queued", completed: 0, total: 1 } }),
  getJob: vi.fn().mockResolvedValue({ id: "job-1", status: "queued", progress: { stage: "queued", completed: 0, total: 1 } }),
  events: vi.fn().mockReturnValue({ close: vi.fn(), onDisconnect: vi.fn() }),
  jobs: vi.fn().mockResolvedValue({ items: [{ id: "job-1", status: "cancel_requested", progress: { stage: "synthesis", completed: 1, total: 2 } }] }),
};

describe("creation flow", () => {
  it("uses server-inspected chapter IDs and submits a preflighted single-voice job", async () => {
    render(<App client={client as never} host={fakeHost()} initialPath="/jobs/new" />);
    await screen.findByRole("heading", { name: "Source" });

    fireEvent.change(screen.getByLabelText("EPUB source"), { target: { files: [new File(["epub"], "book.epub", { type: "application/epub+zip" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect source" }));
    await screen.findByText("Chapter 1");
    fireEvent.click(screen.getByRole("button", { name: "Continue to casting" }));
    await screen.findByRole("radio", { name: /Narrator/ });
    fireEvent.click(screen.getByRole("button", { name: "Continue to synthesis" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to output" }));
    fireEvent.click(screen.getByRole("button", { name: "Review job" }));
    await screen.findByText("42 normalized characters");
    fireEvent.click(screen.getByRole("button", { name: "Start job" }));

    await waitFor(() => expect(client.createJob).toHaveBeenCalled());
    expect(client.preflight).toHaveBeenCalledWith(expect.objectContaining({ chapters: ["stable-chapter"], casting: { voiceId: "voice-1" } }));
    expect(client.createJob).toHaveBeenCalledWith(expect.any(Object), expect.any(String));
  });
});

describe("preflight and capabilities", () => {
  it("displays rejected preflight details and does not create the job", async () => {
    const rejectedClient = {
      ...client,
      preflight: vi.fn().mockResolvedValue({ sourceId: "asset-1", normalizedCharacters: 42, valid: false }),
      createJob: vi.fn(),
    };
    render(<App client={rejectedClient as never} host={fakeHost()} initialPath="/jobs/new" />);
    await screen.findByRole("heading", { name: "Source" });

    fireEvent.change(screen.getByLabelText("EPUB source"), { target: { files: [new File(["epub"], "book.epub", { type: "application/epub+zip" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect source" }));
    await screen.findByText("Chapter 1");
    fireEvent.click(screen.getByRole("button", { name: "Continue to casting" }));
    await screen.findByRole("radio", { name: /Narrator/ });
    fireEvent.click(screen.getByRole("button", { name: "Continue to synthesis" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to output" }));
    fireEvent.click(screen.getByRole("button", { name: "Review job" }));

    await screen.findByText("42 normalized characters");
    expect(screen.getByText("The server rejected this job configuration.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start job" })).toBeDisabled();
    expect(rejectedClient.createJob).not.toHaveBeenCalled();
  });

  it("derives source input types from server capabilities", async () => {
    const pdfClient = {
      ...client,
      capabilities: vi.fn().mockResolvedValue({ apiVersion: "1", auth: { mode: "none" }, billing: { mode: "unmetered" }, casting: { modes: ["single"] }, outputFormats: ["m4b"], sourceFormats: ["pdf"] }),
    };
    render(<App client={pdfClient as never} host={fakeHost()} initialPath="/jobs/new" />);

    const input = await screen.findByLabelText("PDF source");
    expect(input).toHaveAttribute("accept", "application/pdf,.pdf");
  });

  it("does not expose or fetch billing when the server is unmetered", async () => {
    const unmeteredClient = { ...client, billing: vi.fn() };
    render(<App client={unmeteredClient as never} host={fakeHost()} initialPath="/billing" />);

    await screen.findByText("Billing is unavailable on this server.");
    expect(screen.queryByRole("link", { name: "Billing" })).not.toBeInTheDocument();
    expect(unmeteredClient.billing).not.toHaveBeenCalled();
  });
});

describe("job state", () => {
  it("presents cancellation requested until the terminal completed event", async () => {
    let emit: (event: { type: string; progress: { stage: string; completed: number; total: number } }) => void = () => undefined;
    const jobClient = {
      ...client,
      getJob: vi.fn().mockResolvedValue({ id: "job-1", status: "running", progress: { stage: "synthesis", completed: 1, total: 2 } }),
      cancelJob: vi.fn().mockResolvedValue({ id: "job-1", status: "cancel_requested", progress: { stage: "cancelling", completed: 1, total: 2 } }),
      events: vi.fn((_: string, onEvent: typeof emit) => {
        emit = onEvent;
        return { close: vi.fn(), onDisconnect: vi.fn() };
      }),
    };
    render(<App client={jobClient as never} host={fakeHost()} initialPath="/jobs/job-1" />);

    await screen.findByText("Status: running");
    fireEvent.click(screen.getByRole("button", { name: "Cancel job" }));
    await screen.findByText("Status: Cancellation requested");
    expect(screen.getByRole("button", { name: "Cancel job" })).toBeDisabled();

    act(() => emit({ type: "completed", progress: { stage: "complete", completed: 2, total: 2 } }));
    await screen.findByText("Status: succeeded");
    expect(screen.getByRole("button", { name: "Download M4B" })).toBeEnabled();
  });
});

describe("jobs page", () => {
  it("renders server-authoritative job snapshots", async () => {
    render(<App client={client as never} host={fakeHost()} initialPath="/jobs" />);

    await expect(screen.findByText("cancel_requested")).resolves.toBeVisible();
    expect(client.jobs).toHaveBeenCalled();
  });
});

describe("connection failure", () => {
  it("offers a server change when the host can choose servers", async () => {
    const offline = { ...client, capabilities: vi.fn().mockRejectedValue(new Error("offline")) };
    const host = fakeHost({
      can: { chooseServer: true, reachLoopback: true, manageLocalServer: false, saveToPath: true },
    });

    render(<App client={offline as never} host={host} initialPath="/jobs" />);

    await screen.findByText(/offline/);
    expect(screen.getByRole("button", { name: "Choose another server" })).toBeVisible();
  });

  it("offers no server change in the browser, which has a fixed origin", async () => {
    const offline = { ...client, capabilities: vi.fn().mockRejectedValue(new Error("offline")) };

    render(<App client={offline as never} host={fakeHost()} initialPath="/jobs" />);

    await screen.findByText(/offline/);
    expect(screen.queryByRole("button", { name: "Choose another server" })).not.toBeInTheDocument();
  });
});

describe("artifact download", () => {
  it("delegates saving to the host", async () => {
    const blob = new Blob(["audio"], { type: "audio/mp4" });
    const succeeded = {
      ...client,
      getJob: vi.fn().mockResolvedValue({ id: "job-1", status: "succeeded", progress: { stage: "complete", completed: 2, total: 2 } }),
      artifact: vi.fn().mockResolvedValue(blob),
      artifactUrl: vi.fn().mockReturnValue("/v1/jobs/job-1/artifact"),
    };
    const host = fakeHost();

    render(<App client={succeeded as never} host={host} initialPath="/jobs/job-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Download M4B" }));

    await waitFor(() => expect(host.saveArtifact).toHaveBeenCalledWith(
      { url: "/v1/jobs/job-1/artifact", load: expect.any(Function) }, "job-1.m4b",
    ));
    expect(succeeded.artifact).not.toHaveBeenCalled();
    await vi.mocked(host.saveArtifact).mock.calls[0][0].load();
    expect(succeeded.artifact).toHaveBeenCalledWith("job-1");
  });

  it("refetches the job snapshot when the app returns to the foreground", async () => {
    let resume: () => void = () => undefined;
    const onDisconnect = vi.fn().mockResolvedValue(undefined);
    const running = {
      ...client,
      getJob: vi.fn().mockResolvedValue({ id: "job-1", status: "running", progress: { stage: "synthesis", completed: 1, total: 2 } }),
      events: vi.fn().mockReturnValue({ close: vi.fn(), onDisconnect }),
    };
    const host = fakeHost({ onResume: (listener) => { resume = listener; return () => undefined; } });

    render(<App client={running as never} host={host} initialPath="/jobs/job-1" />);
    await screen.findByText("Status: running");
    act(() => resume());

    await waitFor(() => expect(onDisconnect).toHaveBeenCalled());
  });
});
