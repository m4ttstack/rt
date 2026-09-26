/** The slice of a Bun server the peer check needs; a fake satisfies it in tests. */
export interface LocalServer {
  requestIP(req: Request): { address: string } | null;
}

/**
 * Stamped by deck's gateway on every request it proxies from a public
 * hostname. The gateway overwrites any client copy, so its presence is proof
 * the request came in over the public edge.
 */
export const EDGE_HEADER = 'x-mattstack-edge';

/**
 * Headers only a public edge adds: cloudflared sets cf-connecting-ip, and
 * Tailscale funnel sets Tailscale-Funnel-Request (stripping client copies)
 * while keeping the public Host.
 */
const EDGE_MARKERS = [
  'cf-connecting-ip',
  'tailscale-funnel-request',
  EDGE_HEADER,
] as const;

function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
  return h.replace(/:\d+$/, '');
}

function isLocalHost(host: string): boolean {
  const h = hostnameOf(host);
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h.endsWith('.localhost') ||
    h.endsWith('.mattstack')
  );
}

function isLoopbackIP(address: string): boolean {
  const a = address.trim().toLowerCase();
  const v4 = a.startsWith('::ffff:') ? a.slice(7) : a;
  return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

const list = (value: string | null): string[] =>
  value === null ? [] : value.split(',');

/**
 * Whether a request came from this machine rather than through a public
 * edge. Every proxy on this machine (portless, the deck gateway, cloudflared,
 * tailscale) connects from 127.0.0.1, so the socket peer alone proves
 * nothing; Host and the edge headers carry the rest of the proof. All must
 * hold: a loopback peer (when `server` is given), a local Host and
 * x-forwarded-host, loopback-only x-forwarded-for hops, and no edge marker.
 */
export function isLocalRequest(req: Request, server?: LocalServer): boolean {
  const { headers } = req;
  if (server) {
    const peer = server.requestIP(req);
    if (!peer || !isLoopbackIP(peer.address)) return false;
  }
  const host = headers.get('host');
  if (!host || !isLocalHost(host)) return false;
  if (!list(headers.get('x-forwarded-host')).every(isLocalHost)) return false;
  if (!list(headers.get('x-forwarded-for')).every(isLoopbackIP)) return false;
  return EDGE_MARKERS.every(name => !headers.has(name));
}

/**
 * CSRF guard to pair with isLocalRequest: a hostile page in the local browser
 * sends a request isLocalRequest accepts. Browsers attach Origin to every
 * cross-origin write; CLI and daemon callers send none, so absence passes.
 * Otherwise the Origin must be local and name the request's own Host and
 * port, so another local app (any *.localhost dev server) cannot write
 * either. Host carries no scheme, so a portless Host takes the Origin
 * scheme's default port.
 */
export function hasLocalOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin === null) return true;
  const host = req.headers.get('host');
  if (!host) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const defaultPort = url.protocol === 'https:' ? '443' : '80';
  const hostPort = /:(\d+)$/.exec(host.trim())?.[1] ?? defaultPort;
  return (
    isLocalHost(url.host) &&
    hostnameOf(url.host) === hostnameOf(host) &&
    (url.port || defaultPort) === hostPort
  );
}
