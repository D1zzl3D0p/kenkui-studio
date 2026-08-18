import { KenkuiApiError } from "../api/errors";

export function ErrorMessage({ error }: { error?: unknown }) {
  if (!error) return null;
  const message = error instanceof KenkuiApiError && error.requestId ? `${error.message} (request ${error.requestId})` : error instanceof Error ? error.message : "Unexpected error";
  return <p role="alert">{message}</p>;
}
