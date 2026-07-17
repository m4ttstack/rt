/**
 * Whether a request came in over local access (*.localhost / direct) rather
 * than a public tunnel (e.g. Cloudflare). A tunnel forwards the original Host
 * header, so the hostname alone is a reliable signal. This is the single gate
 * for local-only features.
 */
export function isLocalRequest(req: Request): boolean {
  const host = req.headers.get("host");
  if (!host) return false;
  const hostname = host.split(":")[0]!.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");
}
