// Generated from kenkui-server-v2/openapi/v1.json. Do not import server models in the browser.
export interface AssetResponse { id: string; format: string; sha256: string }
export interface ChapterResponse { id: string; title: string; speechCharacters?: number | null }
export interface BookResponse { sourceId: string; title: string; author: string; chapters: ChapterResponse[] }
export interface VoiceResponse { id: string; name: string; language: string | null }
export interface VoiceListResponse { items: VoiceResponse[] }
export interface CastingRequest { voiceId: string }
export interface TtsRequest { normalizeText: boolean }
export interface OutputRequest { format: string }
export interface JobRequest { sourceId: string; chapters: string[]; casting: CastingRequest; tts: TtsRequest; output: OutputRequest }
export interface PreflightResponse { sourceId: string; normalizedCharacters: number; valid?: boolean }
export interface ProgressResponse { stage: string; completed: number; total: number }
export type JobStatus = "queued" | "running" | "cancel_requested" | "succeeded" | "failed" | "cancelled";
export interface JobResponse { id: string; status: JobStatus; progress: ProgressResponse }
export interface JobListResponse { items: JobResponse[] }
export interface EventResponse { sequence: number; type: string; progress: ProgressResponse }
export interface ErrorDetail { code: string; message: string; requestId: string; details?: Record<string, unknown> }
export interface ErrorResponse { error: ErrorDetail }
export interface Capabilities { apiVersion: "1"; auth: { mode: string }; billing: { mode: string }; casting: { mode: string }; outputFormats: string[]; sourceFormats: string[] }
export type BillingResponse = Record<string, string>;
