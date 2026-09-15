export interface BriefInputs {
  template: string; // job-template.md content
  job: string;
  fills: Record<string, string>; // slot name (marker text without brackets) -> value
  method:
    | { kind: "strategy"; strategies: string; name: string } // extract the named body
    | { kind: "file"; content: string }; // domain-supplied Method block
}

export type BriefResult = { ok: true; brief: string } | { ok: false; error: string; leftover?: string[] };

const METHOD_HEADING_RE = /^## Method\r?\n/m;
const NEXT_HEADING_RE = /^## /gm;
const STRATEGY_RE = /^## ([^\n]+)\n+```\n([\s\S]*?)\n```/gm;
const INDENTED_LINE_RE = /^ {4,}/;
const MARKER_RE = /<([^<>\n]+)>/g;

function parseStrategies(strategies: string): { name: string; body: string }[] {
  const found: { name: string; body: string }[] = [];
  let match: RegExpExecArray | null;
  STRATEGY_RE.lastIndex = 0;
  while ((match = STRATEGY_RE.exec(strategies))) {
    const name = match[1];
    const body = match[2];
    if (name === undefined || body === undefined) continue; // regex guarantees both groups when the overall match succeeds
    found.push({ name: name.trim(), body });
  }
  return found;
}

function resolveMethodBody(method: BriefInputs["method"]): { ok: true; body: string } | { ok: false; error: string } {
  if (method.kind === "file") {
    return { ok: true, body: method.content };
  }
  const strategies = parseStrategies(method.strategies);
  const found = strategies.find((s) => s.name === method.name);
  if (!found) {
    const available = strategies.map((s) => s.name).join(", ");
    return { ok: false, error: `unknown strategy '${method.name}'; available: ${available}` };
  }
  return { ok: true, body: found.body };
}

function spliceMethodBody(template: string, body: string): { ok: true; text: string } | { ok: false; error: string } {
  const headingMatch = METHOD_HEADING_RE.exec(template);
  if (!headingMatch) {
    return { ok: false, error: "template has no '## Method' section" };
  }
  const afterHeadingIdx = headingMatch.index + headingMatch[0].length;
  NEXT_HEADING_RE.lastIndex = afterHeadingIdx;
  const nextMatch = NEXT_HEADING_RE.exec(template);
  const nextHeadingStart = nextMatch ? nextMatch.index : template.length;

  const before = template.slice(0, afterHeadingIdx);
  const after = template.slice(nextHeadingStart);
  const trimmedBody = body.replace(/\s+$/, "");
  const separator = nextMatch ? "\n\n" : "\n";
  return { ok: true, text: before + trimmedBody + separator + after };
}

function findLeftoverMarkers(doc: string): string[] {
  const leftover: string[] = [];
  const seen = new Set<string>();
  for (const line of doc.split("\n")) {
    if (INDENTED_LINE_RE.test(line)) continue;
    MARKER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MARKER_RE.exec(line))) {
      const name = m[1];
      if (name === undefined) continue; // regex guarantees this group when the overall match succeeds
      if (!seen.has(name)) {
        seen.add(name);
        leftover.push(name);
      }
    }
  }
  return leftover;
}

export function assembleBrief(inputs: BriefInputs): BriefResult {
  const methodBody = resolveMethodBody(inputs.method);
  if (!methodBody.ok) {
    return { ok: false, error: methodBody.error };
  }

  const spliced = spliceMethodBody(inputs.template, methodBody.body);
  if (!spliced.ok) {
    return { ok: false, error: spliced.error };
  }

  const merged: Record<string, string> = { name: inputs.job, ...inputs.fills };
  let doc = spliced.text;
  for (const [key, value] of Object.entries(merged)) {
    doc = doc.split(`<${key}>`).join(value);
  }

  const leftover = findLeftoverMarkers(doc);
  if (leftover.length > 0) {
    return { ok: false, error: `unfilled markers: ${leftover.join(", ")}`, leftover };
  }

  return { ok: true, brief: doc };
}
