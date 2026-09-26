import type { Seam } from './parseSeam';

/**
 * One slot as the compiled verb's own manifest states it -- boundTo and,
 * where rt could resolve the fill's plugin, its ABSOLUTE source path
 * (`join(<fill's plugin root>, srcPath)`, computed inside rt). Shaped to
 * match `SkillsCompositionSlot` so a real composition verb's `slots` can be
 * passed through unmapped.
 */
export interface AgentContextSlot {
  name: string;
  boundTo: string | null;
  fillSourcePath: string | null;
}

/**
 * The subset of a roster verb this blob draws from. `engineRef` is `null`
 * on a verb whose engine failed to load, in which case `engine` and
 * `engineError` carry the fallback story -- see `engineLine`.
 */
export interface AgentContextVerb {
  name: string;
  engineRef: string | null;
  engine?: string;
  engineError?: string;
  description?: string;
  /**
   * The step's own ABSOLUTE source path (`join(<step plugin root>,
   * srcPath)`, computed inside rt) -- what a `kind: 'step'` seam pairs
   * against. Undefined/null means rt could not resolve it.
   */
  sourcePath?: string | null;
  slots?: AgentContextSlot[];
}

export interface AgentContextInput {
  verb: AgentContextVerb;
  seams: (Seam | null)[];
}

const FALLBACK_LABEL =
  'plugin-relative path, source plugin unresolved -- relative to an unknown plugin root';

function engineLine(verb: AgentContextVerb): string {
  if (verb.engineRef) return `Engine: ${verb.engineRef}`;
  const bare = verb.engine ?? 'unknown';
  const error = verb.engineError
    ? ` (failed to load: ${verb.engineError})`
    : ' (failed to load)';
  return `Engine: ${bare}${error}`;
}

/**
 * The absolute path a seam's span is measured in, per the supplement's
 * pairing rule: a step seam pairs to the verb's own `sourcePath`; a slot
 * seam pairs to the slot of the SAME NAME's `fillSourcePath`. Pairing is by
 * name, never by comparing the seam's plugin-relative `path` against a
 * composition path -- the two are relative to different plugin roots and
 * only coincidentally produce equal strings.
 */
function absolutePathFor(seam: Seam, verb: AgentContextVerb): string | null {
  if (seam.kind === 'step') return verb.sourcePath ?? null;
  const slot = verb.slots?.find(s => s.name === seam.slot);
  return slot?.fillSourcePath ?? null;
}

function seamLine(seam: Seam, verb: AgentContextVerb): string {
  const [start, end] = seam.lines;
  const absolute = absolutePathFor(seam, verb);
  if (absolute) return `${absolute}:${start}-${end}`;
  // No composition path to trust. The seam's own `path` is plugin-relative
  // to a root this blob names nowhere else, so it is labelled rather than
  // pasted as though it resolved from the reader's own working directory.
  return `${seam.path}:${start}-${end} [${FALLBACK_LABEL}]`;
}

function boundFillLines(verb: AgentContextVerb): string[] {
  const bound = (verb.slots ?? []).filter(s => s.boundTo);
  if (bound.length === 0) return [];
  return ['Bound fills:', ...bound.map(s => `  ${s.name} -> ${s.boundTo}`)];
}

/**
 * A plain-text blob naming a verb, its engine, its bound fills, and one
 * `path:start-end` per parsed seam -- meant to be pasted whole into an
 * agent prompt, so no JSON wrapper and no UI concerns here.
 *
 * A seam that failed to parse (`null`, from `parseSeam`) is omitted rather
 * than rendered with placeholder spans: a line reading `file.md:undefined-
 * undefined` points an agent at a region that does not exist, which is
 * worse than naming nothing.
 */
export function buildAgentContext(input: AgentContextInput): string {
  const { verb, seams } = input;
  const parsed = seams.filter((s): s is Seam => s !== null);

  const lines: string[] = [`Verb: ${verb.name}`, engineLine(verb)];
  if (verb.description) lines.push(`Description: ${verb.description}`);

  lines.push('', ...boundFillLines(verb));

  lines.push('', 'Seams:', ...parsed.map(s => seamLine(s, verb)));

  return lines.join('\n');
}
