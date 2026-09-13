import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServersPage } from "../src/pages/servers";
import { fakeHost } from "./fakes/host";

const entries = [
  { id: "cloud", label: "Kenkui Cloud", baseUrl: "https://api.kenkui.example", kind: "cloud" as const },
  { id: "local", label: "Local", baseUrl: "http://127.0.0.1:7850", kind: "custom" as const },
];

describe("servers page", () => {
  it("lists known servers and selects one", async () => {
    const host = fakeHost({
      can: { chooseServer: true, reachLoopback: true, manageLocalServer: false, saveToPath: true },
    });
    host.servers.list = vi.fn().mockResolvedValue(entries);
    const onSelect = vi.fn();

    render(<ServersPage host={host} onSelect={onSelect} />);
    fireEvent.click(await screen.findByRole("button", { name: "Use Local" }));

    await waitFor(() => expect(host.servers.select).toHaveBeenCalledWith("local"));
    expect(onSelect).toHaveBeenCalled();
  });

  it("surfaces a rejected server instead of adding it", async () => {
    const host = fakeHost({
      can: { chooseServer: true, reachLoopback: false, manageLocalServer: false, saveToPath: false },
    });
    host.servers.list = vi.fn().mockResolvedValue(entries);
    host.servers.add = vi.fn().mockRejectedValue(new Error("This device cannot reach a loopback address."));

    render(<ServersPage host={host} onSelect={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Server address"), {
      target: { value: "http://127.0.0.1:7850" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));

    await screen.findByText("This device cannot reach a loopback address.");
  });
});
