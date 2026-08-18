import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app";

const client = {
  capabilities: vi.fn().mockResolvedValue({ apiVersion: "1", auth: { mode: "none" }, billing: { mode: "unmetered" }, casting: { mode: "single" }, outputFormats: ["m4b"], sourceFormats: ["epub"] }),
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
    render(<App client={client as never} initialPath="/jobs/new" />);
    await screen.findByRole("heading", { name: "Source" });

    fireEvent.change(screen.getByLabelText("EPUB source"), { target: { files: [new File(["epub"], "book.epub", { type: "application/epub+zip" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect source" }));
    await screen.findByText("Chapter 1");
    fireEvent.click(screen.getByRole("button", { name: "Continue to casting" }));
    await screen.findByRole("radio", { name: /Narrator/ });
    fireEvent.click(screen.getByRole("button", { name: "Continue to synthesis" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to output" }));
    fireEvent.click(screen.getByRole("button", { name: "Review job" }));
    fireEvent.click(screen.getByRole("button", { name: "Start job" }));

    await waitFor(() => expect(client.createJob).toHaveBeenCalled());
    expect(client.preflight).toHaveBeenCalledWith(expect.objectContaining({ chapters: ["stable-chapter"], casting: { voiceId: "voice-1" } }));
    expect(client.createJob).toHaveBeenCalledWith(expect.any(Object), expect.any(String));
  });
});

describe("jobs page", () => {
  it("renders server-authoritative job snapshots", async () => {
    render(<App client={client as never} initialPath="/jobs" />);

    await expect(screen.findByText("cancel_requested")).resolves.toBeVisible();
    expect(client.jobs).toHaveBeenCalled();
  });
});
