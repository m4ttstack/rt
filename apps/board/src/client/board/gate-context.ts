/** A gate's context split at its `=== key label — verdict X → recommend Y ===`
    markers, one section per question, so the form can seat each question's
    own reasoning beside its choices instead of leaving it in the blob. The
    parse is tolerant: a header needs only the key; a body is kept whole,
    with a leading `Name: "..."` quote and an `Adjudication:` paragraph
    lifted out when present. */

export interface ContextQuote {
  who: string;
  text: string;
}

export interface ContextSection {
  key: string;
  label?: string;
  verdict?: string;
  /** Lowercased, so it compares against a choice label as typed. */
  recommendation?: string;
  quote?: ContextQuote;
  adjudication?: string;
  /** What follows the quote when no `Adjudication:` marker names it. */
  remainder?: string;
  /** The section's whole body, paragraphs joined by blank lines. */
  body: string;
}

export interface ParsedGateContext {
  preamble: string;
  sections: Map<string, ContextSection>;
}

const HEADER = /^\s*={2,}\s*(\S+)(?:\s+(.*?))?\s*={2,}\s*$/;
const VERDICT = /\bverdict:?\s+([^\u2192=,)]+?)(?=\s*(?:\u2192|,|\)|$))/i;
const RECOMMEND = /\brecommend(?:ed|s|ation)?:?\s+(\w+)/i;
const QUOTE_OPEN = /^([^:"\n]{1,40}):\s*"(.*)$/;
const ADJUDICATION = /^adjudication:\s*/i;

function unwrap(lines: string[]): string {
  return lines
    .map(l => l.trim())
    .filter(Boolean)
    .join(' ');
}

function parseHeaderRest(rest: string | undefined): {
  label?: string;
  verdict?: string;
  recommendation?: string;
} {
  if (!rest) return {};
  const verdict = VERDICT.exec(rest)?.[1]?.trim();
  const recommendation = RECOMMEND.exec(rest)?.[1]?.toLowerCase();
  const label = rest
    .split(/\s+[\u2014\u2013-]\s+|\s*\u2192\s*/)[0]!
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
  return {
    ...(label ? { label } : {}),
    ...(verdict ? { verdict } : {}),
    ...(recommendation ? { recommendation } : {}),
  };
}

function paragraphs(lines: string[]): string {
  const out: string[] = [];
  let run: string[] = [];
  for (const line of lines) {
    if (line.trim()) run.push(line);
    else if (run.length) {
      out.push(unwrap(run));
      run = [];
    }
  }
  if (run.length) out.push(unwrap(run));
  return out.join('\n\n');
}

function parseBody(
  lines: string[]
): Pick<ContextSection, 'quote' | 'adjudication' | 'remainder' | 'body'> {
  const body = paragraphs(lines);
  const content = lines.map(l => l.trim());
  let at = content.findIndex(Boolean);
  if (at < 0) return { body };

  // A leading `Name: "..."` is the reviewer's words; it runs to its closing
  // mark. `Adjudication:` may sit on the next line or a paragraph later and
  // runs to the end of the section.
  let quote: ContextQuote | undefined;
  const open = QUOTE_OPEN.exec(content[at]!);
  if (open) {
    const collected = [open[2]!];
    at++;
    while (
      !collected[collected.length - 1]!.endsWith('"') &&
      at < content.length
    ) {
      collected.push(content[at]!);
      at++;
    }
    quote = { who: open[1]!.trim(), text: unwrap(collected).replace(/"$/, '') };
  }
  const after = lines.slice(at);
  const adjAt = after.findIndex(l => ADJUDICATION.test(l.trim()));
  const adjudication =
    adjAt >= 0
      ? paragraphs([
          after[adjAt]!.trim().replace(ADJUDICATION, ''),
          ...after.slice(adjAt + 1),
        ])
      : undefined;
  const remainder =
    adjudication === undefined && quote ? paragraphs(after) : undefined;
  return {
    ...(quote ? { quote } : {}),
    ...(adjudication ? { adjudication } : {}),
    ...(remainder ? { remainder } : {}),
    body,
  };
}

export function parseGateContext(
  context: string | undefined | null
): ParsedGateContext | null {
  if (!context) return null;
  const lines = context.split(/\r?\n/);
  const sections = new Map<string, ContextSection>();
  const preambleLines: string[] = [];
  let current: { head: RegExpExecArray; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const key = current.head[1]!;
    sections.set(key, {
      key,
      ...parseHeaderRest(current.head[2]),
      ...parseBody(current.lines),
    });
  };
  for (const line of lines) {
    const head = HEADER.exec(line);
    if (head) {
      flush();
      current = { head, lines: [] };
    } else if (current) current.lines.push(line);
    else preambleLines.push(line);
  }
  flush();
  if (sections.size === 0) return null;
  return { preamble: unwrap(preambleLines), sections };
}

/** The section a question owns: by key (the question id the asker used for
    the marker), else by label (the file:line both sides spell the same). */
export function sectionFor(
  parsed: ParsedGateContext | null,
  question: { id: string; label?: string }
): ContextSection | undefined {
  if (!parsed) return undefined;
  const byKey = parsed.sections.get(question.id);
  if (byKey) return byKey;
  const label = question.label?.trim().toLowerCase();
  if (!label) return undefined;
  for (const s of parsed.sections.values())
    if (s.label?.toLowerCase() === label) return s;
  return undefined;
}
