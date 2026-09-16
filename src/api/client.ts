import { asApiError } from "./errors";
import {
  connectJobEvents,
  type EventSourceFactory,
  type JobEventStream,
} from "./events";
import type {
  AssetResponse,
  BillingResponse,
  BookResponse,
  Capabilities,
  EventResponse,
  JobListResponse,
  JobRequest,
  JobResponse,
  PreflightResponse,
  VoiceListResponse,
} from "./generated/v1";

export interface ClientDependencies {
  fetch?: typeof globalThis.fetch;
  eventSource?: EventSourceFactory;
  getJob?: (jobId: string) => Promise<JobResponse>;
}

/** The browser's only HTTP and SSE boundary to a Kenkui server. */
export class KenkuiServerClient {
  private readonly request: typeof globalThis.fetch;
  private readonly EventSourceConstructor?: EventSourceFactory;
  private readonly getJobOverride?: (jobId: string) => Promise<JobResponse>;

  constructor(
    private readonly baseUrl = "",
    dependencies: ClientDependencies = {},
  ) {
    this.request = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.EventSourceConstructor =
      dependencies.eventSource ??
      (globalThis.EventSource as unknown as EventSourceFactory | undefined);
    this.getJobOverride = dependencies.getJob;
  }

  storageScope(): string {
    return this.baseUrl || "same-origin";
  }
  async session(): Promise<{ userId: string }> {
    return this.json("/v1/auth/session");
  }
  async cover(assetId: string): Promise<Blob> {
    const response = await this.request(
      this.url(`/v1/assets/${encodeURIComponent(assetId)}/cover`),
      { credentials: "include" },
    );
    if (!response.ok) throw await asApiError(response);
    return response.blob();
  }
  async uploadCover(assetId: string, file: File): Promise<AssetResponse> {
    return this.json(`/v1/assets/${encodeURIComponent(assetId)}/cover`, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
  }

  authUrl(action: "login" | "logout"): string {
    return this.url(`/v1/auth/${action}`);
  }

  async capabilities(): Promise<Capabilities> {
    return this.json("/v1/capabilities");
  }
  async billing(): Promise<BillingResponse> {
    return this.json("/v1/billing");
  }
  async creditHistory(): Promise<import("./generated/v1").CreditHistoryResponse> {
    return this.json("/v1/billing/history");
  }
  async checkout(credits: number): Promise<{ url: string }> {
    return this.json("/v1/billing/checkout", this.jsonBody({ credits }));
  }
  async voices(): Promise<VoiceListResponse> {
    return this.json("/v1/voices");
  }

  async upload(file: File): Promise<AssetResponse> {
    const contentType =
      file.type ||
      (file.name.toLowerCase().endsWith(".epub")
        ? "application/epub+zip"
        : "application/octet-stream");
    return this.json("/v1/assets", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: file,
    });
  }
  async inspectBook(assetId: string): Promise<BookResponse> {
    return this.json(`/v1/assets/${encodeURIComponent(assetId)}/book`);
  }
  async preflight(payload: JobRequest): Promise<PreflightResponse> {
    return this.json("/v1/jobs/preflight", this.jsonBody(payload));
  }
  async jobs(): Promise<JobListResponse> {
    return this.json("/v1/jobs");
  }

  async createJob(
    payload: JobRequest,
    idempotencyKey: string,
  ): Promise<JobResponse> {
    const init = this.jsonBody(payload, { "Idempotency-Key": idempotencyKey });
    try {
      return await this.json("/v1/jobs", init);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return this.json("/v1/jobs", init);
    }
  }

  async getJob(jobId: string): Promise<JobResponse> {
    return (
      this.getJobOverride?.(jobId) ??
      this.json(`/v1/jobs/${encodeURIComponent(jobId)}`)
    );
  }
  async cancelJob(jobId: string): Promise<JobResponse> {
    return this.json(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
    });
  }
  artifactUrl(jobId: string): string {
    return this.url(`/v1/jobs/${encodeURIComponent(jobId)}/artifact`);
  }

  async artifact(jobId: string): Promise<Blob> {
    const response = await this.request(
      this.url(`/v1/jobs/${encodeURIComponent(jobId)}/artifact`),
      { credentials: "include" },
    );
    if (!response.ok) throw await asApiError(response);
    return response.blob();
  }

  events(
    jobId: string,
    onEvent?: (event: EventResponse) => void,
    onSnapshot?: (job: JobResponse) => void,
    onConnection?: (
      state: "connected" | "reconnecting" | "disconnected",
    ) => void,
  ): JobEventStream {
    if (!this.EventSourceConstructor)
      throw new Error("This browser does not support server-sent events.");
    return connectJobEvents(
      this.url(`/v1/jobs/${encodeURIComponent(jobId)}/events`),
      this.EventSourceConstructor,
      () => this.getJob(jobId),
      onEvent,
      onSnapshot,
      onConnection,
    );
  }

  private jsonBody(body: unknown, headers: HeadersInit = {}): RequestInit {
    return {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    };
  }
  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(this.url(path), {
      credentials: "include",
      ...init,
    });
    if (!response.ok) throw await asApiError(response);
    return response.json() as Promise<T>;
  }
  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }
}
