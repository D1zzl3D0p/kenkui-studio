import { vi } from "vitest";
import type { Host, ServerEntry } from "../../src/host/index";

const origin: ServerEntry = { id: "origin", label: "This server", baseUrl: "", kind: "origin" };

/** A Host for component tests. Override only what the test is about. */
export function fakeHost(overrides: Partial<Host> = {}): Host {
  return {
    platform: "web",
    can: { chooseServer: false, reachLoopback: true, manageLocalServer: false, saveToPath: false },
    transport: () => ({}),
    servers: {
      list: vi.fn().mockResolvedValue([origin]),
      selected: vi.fn().mockResolvedValue(origin),
      select: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(origin),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    saveArtifact: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    onResume: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
}
