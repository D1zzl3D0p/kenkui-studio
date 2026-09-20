import { vi } from "vitest";
import type { Host, Notifications, ServerEntry } from "../../src/host/index";

const origin: ServerEntry = { id: "origin", label: "This server", baseUrl: "", kind: "origin" };

/** Notifications that record what they were asked to show. */
export function fakeNotifications(
  permission: "granted" | "denied" | "default" = "granted",
): Notifications & { shown: { title: string; body: string; path?: string }[] } {
  const shown: { title: string; body: string; path?: string }[] = [];
  return {
    shown,
    permission: vi.fn().mockResolvedValue(permission),
    request: vi.fn().mockResolvedValue("granted"),
    show: vi.fn(async (notice) => {
      shown.push(notice);
    }),
  };
}

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
