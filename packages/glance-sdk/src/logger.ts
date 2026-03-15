/**
 * Logger interface for @forge-glance/sdk.
 *
 * All providers and clients accept an optional `logger` in their constructor
 * that must satisfy this interface. Defaults to `noopLogger` when omitted,
 * so the SDK is silent out of the box.
 *
 * Consumers can pass any compatible logger — pino, winston, console, etc.
 *
 * @example
 * import pino from 'pino';
 * const provider = new GitLabProvider(url, token, { logger: pino() });
 */
export interface ForgeLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export const noopLogger: ForgeLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
