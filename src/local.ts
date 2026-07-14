/**
 * Whether a request came in over local access (mrs.localhost / direct) rather
 * than the public Cloudflare tunnel (mrs.m4tthew.dev). The tunnel forwards the
 * original Host header, so the hostname alone is a reliable signal. This is the
 * single gate for local-only features.
 */
export function isLocalRequest(req: Request): boolean {
  const host = req.headers.get("host");
  if (!host) return false;
  const hostname = host.split(":")[0]!.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");
}
