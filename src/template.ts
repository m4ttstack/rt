/** Template rendering shared by the copy button (client) and post-to-slack (server).
    Placeholders use `{name}` and are replaced with the MR's field. Unknown
    placeholders are left as-is so users see what they mistyped. */

export interface MrFacts {
  iid: number;
  title: string;
  url: string;
  ticket: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
}

const KEYS: Array<keyof MrFacts> = ["iid", "title", "url", "ticket", "author", "sourceBranch", "targetBranch"];

function replace(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k]! : m));
}

export function renderMr(template: string, facts: MrFacts): string {
  const values: Record<string, string> = {};
  for (const k of KEYS) values[k] = String(facts[k] ?? "");
  return replace(template, values);
}

export function renderMulti(header: string, item: string, facts: MrFacts[]): string {
  const head = replace(header, { count: String(facts.length) });
  const lines = facts.map((f) => renderMr(item, f));
  return [head, ...lines].join("\n");
}
