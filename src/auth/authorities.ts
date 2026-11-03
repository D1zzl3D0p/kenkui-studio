// Public release metadata. Neither API discovery nor the native server picker can add a pin.
interface Authority {
  apiOrigin: string;
  issuer: string;
  jwksUrl: string;
  clientId: string;
  resource: string;
}
function https(value: unknown) {
  if (typeof value !== "string")
    throw new Error("Invalid hosted sign-in configuration.");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.href.includes("?") ||
    url.href.includes("#")
  )
    throw new Error("Invalid hosted sign-in configuration.");
  return url;
}
export function expectedAuthority(
  origin: string,
  encoded: string | undefined,
): Authority {
  const entries: unknown = JSON.parse(encoded ?? "[]");
  if (!Array.isArray(entries))
    throw new Error("Invalid hosted sign-in configuration.");
  const recipients = new Map<string, Authority>();
  const issuers = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Object.keys(entry).length !== 5)
      throw new Error("Invalid hosted sign-in configuration.");
    const issuer = https(entry.issuer);
    if (
      https(entry.apiOrigin).origin !== entry.apiOrigin ||
      entry.resource !== entry.apiOrigin ||
      issuer.href !== entry.issuer ||
      issuer.pathname.endsWith("/") ||
      https(entry.jwksUrl).href !== entry.jwksUrl ||
      typeof entry.clientId !== "string" ||
      !entry.clientId.trim() ||
      recipients.has(entry.apiOrigin) ||
      issuers.has(issuer.origin)
    )
      throw new Error("Invalid hosted sign-in configuration.");
    recipients.set(entry.apiOrigin, entry);
    issuers.add(issuer.origin);
  }
  const authority = recipients.get(origin);
  if (!authority)
    throw new Error(
      "This Studio build does not trust hosted sign-in for this server.",
    );
  return authority;
}
