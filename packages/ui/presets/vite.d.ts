import type { UserConfig } from 'vite';

export interface MattstackViteOptions {
  /** The Bun/Hono server's port; the dev proxy forwards /api and /ws to it. */
  apiPort: number;
  /** @default true */
  proxy?: boolean;
  /** Additional `codeSplitting.groups`, matched before the kit's. */
  extraGroups?: { name: string; test: RegExp }[];
}

export function mattstackVite(opts: MattstackViteOptions): UserConfig;
