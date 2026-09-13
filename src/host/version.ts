/** The /v1 API versions this build understands. */
export const supportedApiVersions = ["1"] as const;

export function isSupportedApiVersion(capabilities: { apiVersion?: string }): boolean {
  return (supportedApiVersions as readonly string[]).includes(capabilities.apiVersion ?? "");
}
