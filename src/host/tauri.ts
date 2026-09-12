import type { Host } from "./index";

/** The native host. Filled in by later tasks; shape fixed now so builds resolve. */
export async function createHost(): Promise<Host> {
  throw new Error("The native host is not implemented yet.");
}
