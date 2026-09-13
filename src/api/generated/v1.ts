// Portable aliases for the generated OpenAPI schemas.
import type { components } from "./schema";

export type AssetResponse = components["schemas"]["AssetResponse"];
export type ChapterResponse = components["schemas"]["ChapterResponse"];
export type BookResponse = components["schemas"]["BookResponse"];
export type VoiceResponse = components["schemas"]["VoiceResponse"];
export type VoiceListResponse = components["schemas"]["VoiceListResponse"];
export type CastingRequest = components["schemas"]["CastingRequest"];
export type TtsRequest = components["schemas"]["TtsRequest"];
export type OutputRequest = components["schemas"]["OutputRequest"];
export type JobRequest = components["schemas"]["JobRequest"];
export type PreflightResponse = components["schemas"]["PreflightResponse"];
export type ProgressResponse = components["schemas"]["ProgressResponse"];
export type JobResponse = components["schemas"]["JobResponse"];
export type JobListResponse = components["schemas"]["JobListResponse"];
export type EventResponse = components["schemas"]["EventResponse"];
export type ErrorDetail = components["schemas"]["ErrorDetail"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];
export type Capabilities = components["schemas"]["Capabilities"];
export type JobStatus = JobResponse["status"];
export type BillingResponse = Record<string, string>;
