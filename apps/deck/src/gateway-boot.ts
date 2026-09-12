import type { Server } from 'bun';

import { startGateway } from '../core/gateway.ts';
import type { WsProxyData } from '../core/ws-proxy.ts';

export interface GatewayBootDeps {
  start: () => Server<WsProxyData>;
  exit: (code: number) => void;
  err: (...args: unknown[]) => void;
}

const live: GatewayBootDeps = {
  start: () => startGateway(),
  exit: code => process.exit(code),
  err: console.error,
};

/**
 * The gateway is deck's only public edge: without it every tunnel request is
 * a 502 while /healthz stays green. A bind failure is the outgoing instance
 * (or a hand-run `bun run serve`) still holding the port, so exit non-zero
 * and let launchd's KeepAlive retry after its throttle rather than carry on
 * as a deck with no front door.
 */
export function bindGatewayOrExit(
  deps: GatewayBootDeps = live
): Server<WsProxyData> | null {
  try {
    return deps.start();
  } catch (err) {
    deps.err('gateway failed to start, exiting so launchd retries:', err);
    deps.exit(1);
    return null;
  }
}
