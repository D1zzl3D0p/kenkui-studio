import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Startup } from "../src/startup";
import { fakeHost } from "./fakes/host";
import type { KenkuiServerClient } from "../src/api/client";

vi.mock("../src/app", () => ({
  App: ({ client }: { client: KenkuiServerClient }) => <p>Connected to {client.storageScope()}</p>,
}));

describe("startup", () => {
  it("shows the picker on first launch and connects after selection", async () => {
    const host = fakeHost({ can: { chooseServer: true, reachLoopback: true, saveToPath: true, manageLocalServer: false } });
    host.servers.selected = vi.fn().mockResolvedValue(undefined);
    host.servers.select = vi.fn().mockImplementation(async () => {
      host.servers.selected = vi.fn().mockResolvedValue({ baseUrl: "http://127.0.0.1:7850" });
    });
    render(<Startup loadHost={async () => host} />);
    expect(screen.getByRole("status")).toHaveTextContent("Opening");
    fireEvent.click(await screen.findByRole("button", { name: "Use This server" }));
    expect(await screen.findByText("Connected to http://127.0.0.1:7850")).toBeVisible();
  });

  it("recovers from native initialization failure without reloading", async () => {
    const loadHost = vi.fn().mockRejectedValueOnce(new Error("Settings are unavailable"))
      .mockResolvedValue(fakeHost());
    render(<Startup loadHost={loadHost} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Settings are unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Connected to same-origin")).toBeVisible();
  });

  it("surfaces selection read failures instead of mounting an invalid client", async () => {
    const host = fakeHost();
    host.servers.selected = vi.fn().mockRejectedValue("Settings could not be read");
    render(<Startup loadHost={async () => host} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Settings could not be read");
    expect(screen.queryByText(/Connected to/)).toBeNull();
  });
});
