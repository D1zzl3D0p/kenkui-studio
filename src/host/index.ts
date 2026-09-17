import type { ClientDependencies } from "../api/client";

/** What the surrounding application can do, independent of which server it talks to. */
export interface HostCapabilities {
  /** The user may point the app at a different server. False for the hosted SPA. */
  chooseServer: boolean;
  /** 127.0.0.1 is reachable. False on mobile, where no local server exists. */
  reachLoopback: boolean;
  /** The host can start and supervise a local server. Reserved for the future sidecar. */
  manageLocalServer: boolean;
  /** Artifacts can be written to a user-chosen filesystem path. */
  saveToPath: boolean;
}

/** An artifact the host may either stream by URL or load into memory first. */
export interface ArtifactSource {
  url: string;
  load(): Promise<Blob>;
}

export interface SaveArtifactOptions {
  signal?: AbortSignal;
  onProgress?(progress: { received: number; total?: number | null; phase?: "sharing" }): void;
}

export interface ServerEntry {
  id: string;
  label: string;
  /** Empty string means "the origin this bundle was served from". */
  baseUrl: string;
  kind: "origin" | "cloud" | "custom" | "managed";
}

export interface ServerRegistry {
  list(): Promise<ServerEntry[]>;
  /** Undefined until a server has been chosen on a native first launch. */
  selected(): Promise<ServerEntry | undefined>;
  select(id: string): Promise<void>;
  add(baseUrl: string, label?: string): Promise<ServerEntry>;
  remove(id: string): Promise<void>;
}

/** The application's only boundary to the platform it runs on. */
export interface Host {
  /** Branding and diagnostics only. Never branch feature behavior on this. */
  readonly platform: "web" | "desktop" | "mobile";
  readonly can: HostCapabilities;
  /** baseUrl scopes credential attachment, so a Cloud token never reaches a LAN server. */
  transport(baseUrl: string): ClientDependencies;
  readonly servers: ServerRegistry;
  /** Native-owned authentication. Absent for browser cookie sessions. */
  readonly auth?: {
    restore(origin: string): Promise<void>;
    signIn(origin: string): Promise<void>;
    cancelSignIn(): Promise<void>;
    signOut(origin: string): Promise<void>;
    onChanged(listener: () => void): () => void;
  };
  saveArtifact(artifact: ArtifactSource, suggestedName: string, options?: SaveArtifactOptions): Promise<void>;
  openExternal(url: string): Promise<void>;
  /**
   * Fires when the app returns to the foreground. Mobile suspends the process
   * and kills the SSE stream, which would otherwise exhaust the three recovery
   * attempts in events.ts while asleep. Returns an unsubscribe function.
   */
  onResume(listener: () => void): () => void;
}
