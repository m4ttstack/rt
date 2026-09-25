import type { FlowResult } from './api/register.ts';

interface Swept {
  created?: string[];
  adopted?: string[];
  restarted?: string[];
  notServed?: string[];
  failed?: Array<{ name: string; error: string }>;
}

/**
 * Launching the other mattstack app starts a different deck with the other
 * flavor, so managed apps installed by the previous one must move over. Only
 * a bundled deck sweeps: a source `deck serve` from a checkout shares the
 * real launchd agents and must never rewrite them.
 */
export async function reresolveOnBoot(opts: {
  bundleRoot: string | null;
  reresolve: () => Promise<FlowResult>;
  log: (line: string) => void;
}): Promise<void> {
  if (!opts.bundleRoot) return;
  let body: Swept;
  try {
    body = (await opts.reresolve()).body as Swept;
  } catch (err) {
    opts.log(`[reresolve] boot sweep failed: ${String(err)}`);
    return;
  }
  const parts: string[] = [];
  if (body.created?.length) parts.push(`created ${body.created.join(', ')}`);
  if (body.adopted?.length) parts.push(`adopted ${body.adopted.join(', ')}`);
  if (body.restarted?.length)
    parts.push(`restarted ${body.restarted.join(', ')}`);
  if (body.notServed?.length)
    parts.push(`not-served ${body.notServed.join(', ')}`);
  if (body.failed?.length)
    parts.push(
      `failed ${body.failed.map(f => `${f.name} (${f.error})`).join(', ')}`
    );
  if (parts.length) opts.log(`[reresolve] boot: ${parts.join('; ')}`);
}

/**
 * Settles when the boot sweep does, or at `capMs`: launchd and portless calls
 * carry no timeout, and a sweep wedged on one must not keep the app catalog
 * unanswered for the rest of the session.
 */
export function bootSweepGate(
  sweep: Promise<unknown>,
  capMs: number
): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, capMs);
    const open = () => {
      clearTimeout(timer);
      resolve();
    };
    sweep.then(open, open);
  });
}
