export interface DiscoveryApp {
  name: string;
  displayName: string;
  description?: string;
  url: string;
  icon: string | null;
}

export interface DiscoveryResponse {
  apps: DiscoveryApp[];
}

/**
 * The deck discovery origin for a mattstack surface. `override` (the
 * launcher's `deckBase` prop) wins for dev and custom domains. A host that is
 * neither `*.mattstack` nor `*.localhost` yields null, so the launcher hides
 * rather than firing a doomed cross-origin fetch.
 */
export function deriveDeckBase(
  origin: string,
  override?: string
): string | null {
  if (override) return override.replace(/\/+$/, '');
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return null;
  }
  if (host === 'mattstack' || host.endsWith('.mattstack'))
    return 'https://deck.mattstack';
  if (host === 'localhost' || host.endsWith('.localhost'))
    return 'https://deck.localhost';
  return null;
}
