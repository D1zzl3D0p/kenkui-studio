import type { ErrorResponse } from "./generated/v1";

export class KenkuiApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(status: number, message: string, response?: ErrorResponse) {
    super(response?.error.message ?? message);
    this.name = "KenkuiApiError";
    this.status = status;
    this.code = response?.error.code;
    this.requestId = response?.error.requestId;
  }
}

export async function asApiError(response: Response): Promise<KenkuiApiError> {
  let body: ErrorResponse | undefined;
  try { body = await response.json() as ErrorResponse; } catch { /* non-JSON error */ }
  return new KenkuiApiError(response.status, response.statusText || "Request failed", body);
}
