// Browsers cannot choose their Origin/Host headers. Apply this to the direct
// HTTP bridge as well as nginx; it is CSWSH protection, not authentication.
export function bridgeOriginAllowed(
  origin: string | undefined,
  host: string,
): boolean {
  if (origin === undefined) return true; // Non-browser clients use network access policy.
  try {
    const source = new URL(origin);
    return (
      (source.protocol === "http:" || source.protocol === "https:") &&
      source.origin === origin &&
      source.host === new URL(`${source.protocol}//${host}`).host
    );
  } catch {
    return false;
  }
}
