import { MATTSTACK_TLD } from '../../core/discover.ts';
import { isMattstackOwned, type AppRecord } from './records.ts';

export const CANONICAL_HOST_ENV = 'MATTSTACK_CANONICAL_HOST';

/** The launchd environment for a supervised record: manifest env first, then
    the values deck owns (PORT, and for a mattstack app the host its .localhost
    alias redirects to), which a manifest never overrides. */
export function serviceEnv(record: AppRecord): Record<string, string> {
  const env: Record<string, string> = {
    ...(record.env ?? {}),
    PORT: String(record.port),
  };
  if (isMattstackOwned(record))
    env[CANONICAL_HOST_ENV] = `${record.name}.${MATTSTACK_TLD}`;
  return env;
}
