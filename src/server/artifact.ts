import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

/** The spec's "last ~40 lines". Not configurable: a knob here is the first
    step toward the log viewer the spec refuses. */
export const EXCERPT_LINES = 40;

export interface Excerpt {
  lines: string[];
  truncated: boolean;
}

/**
 * `root` is the run's own directory. Resolving both sides and testing the
 * relative path is what makes `../` and absolute-path escapes fail closed --
 * a prefix string comparison would pass `/runs/../runs-evil`.
 */
export function readExcerpt(path: string, root: string): Excerpt {
  const abs = resolve(path);
  const rel = relative(resolve(root), abs);
  if (rel.startsWith('..') || resolve(root) === abs) {
    throw new Error(`artifact path is outside the run directory: ${path}`);
  }

  let text: string;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    return { lines: [], truncated: false };
  }

  const all = text.split('\n');
  if (all.at(-1) === '') all.pop();
  const truncated = all.length > EXCERPT_LINES;
  return { lines: truncated ? all.slice(-EXCERPT_LINES) : all, truncated };
}
