import type { LocalServer, LocalServerStatus } from "./index";

export function createLocalServer(
  invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>,
): LocalServer {
  const request = (action: string) => invoke(`kenkui_local_server_${action}`, {}) as Promise<LocalServerStatus>;
  return {
    status: () => request("status"),
    start: () => request("start"),
    stop: () => request("stop"),
  };
}
