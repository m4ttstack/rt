import { lstatSync, readdirSync, readFileSync } from "fs";
import { join, sep } from "path";
import { HEADER_COMMENT } from "./compile.ts";

export interface LintRule { id: string; pattern: RegExp; tool: string; note: string }
export interface LintHit { file: string; line: number; text: string; rule: string; tool: string; note: string }

// The replacement table, as patterns over code-shaped text (fenced blocks and
// inline spans). Order matters only for which rule names a line first.
export const MCP_LINT_RULES: LintRule[] = [
  { id: "run-db-env", pattern: /\b(export|unset)\s+RT_RUN_DB\b/, tool: "run_start", note: "keep the runDb run_start returns and pass it on every run_* call" },
  { id: "subst", pattern: /\b[A-Za-z_][A-Za-z0-9_]*=\$\(\s*(rt|glab)\b/, tool: "mr_for_branch", note: "a tool returns the value; nothing needs a shell variable (the tool depends on the inner call: glab mr list is mr_for_branch or mr_list, rt runs is run_*)" },
  { id: "rt-runs", pattern: /\brt runs\b/, tool: "run_stage", note: "run_start, run_stage, run_field_set, run_field_get, run_decision, run_status, run_snapshot, run_list" },
  { id: "rt-sync", pattern: /\brt sync\b/, tool: "branch_sync", note: "one call: fetch, cherry-gated reset, rebase, force-with-lease push" },
  { id: "rt-worktree", pattern: /\brt worktree (provision|dispose)\b/, tool: "worktree_provision", note: "worktree_provision or worktree_dispose" },
  { id: "rt-herd", pattern: /\brt herd\b/, tool: "herd_spawn", note: "herd_start, herd_spawn, herd_brief, herd_close, herd_status, herd_list, herd_attend, herd_wrap_up, herd_resume, herd_ask, herd_answer, herd_report, herd_milestone" },
  { id: "gate-ask", pattern: /\brt gate ask\b/, tool: "gate_ask", note: "read the questions file and pass its questions, kind and context" },
  { id: "glab", pattern: /\bglab\b/, tool: "mr_view", note: "mr_view, mr_list, mr_for_branch, mr_threads, mr_pipeline, mr_job_trace, mr_merge, or an mr_* write" },
  { id: "git-push", pattern: /\bgit push\b/, tool: "git_push", note: "setUpstream: true for a first push, forceWithLease: true after a rebase" },
  { id: "git-rebase", pattern: /\bgit rebase\b(?!\s+--(continue|skip)\b)/, tool: "git_rebase", note: "onto: \"origin/<default>\" (it fetches), or abort: true" },
  { id: "git-pull", pattern: /\bgit pull\b/, tool: "git_pull", note: "fast-forward only" },
  { id: "worktree-add", pattern: /\bgit worktree add\b/, tool: "worktree_provision", note: "sibling worktrees are never created by hand" },
  { id: "pkill", pattern: /\bpkill\b|\bkill\s+(-\w+\s+)?\$/, tool: "worktree_stop_holders", note: "ends only the processes rt ties to the tree" },
];

// Written in one bare form by the skills; each stays on Bash on purpose.
export const KEPT_ON_BASH: RegExp[] = [
  /\brt gate answer\b.*--by shepherd\b/,
  /\brt gate wait\b/,
  /\brt chat tail\b/,
  /\brt events wait\b/,
];

const FENCE = /^\s*(```|~~~)/;
const INLINE = /`([^`\n]+)`/g;
export const ALLOW_MARKER = /<!--\s*mcp-lint:\s*allow\s*-->/;

/** Code-shaped text per line: whole lines inside a fence, inline spans outside
    one. A line carrying the allow marker, or sitting under a marker-only line,
    is dropped here so no rule sees it. */
function codeOn(lines: string[]): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let fenced = false;
  lines.forEach((raw, i) => {
    if (FENCE.test(raw)) { fenced = !fenced; return; }
    if (ALLOW_MARKER.test(raw)) return;
    const prev = lines[i - 1] ?? "";
    if (ALLOW_MARKER.test(prev) && prev.replace(ALLOW_MARKER, "").trim() === "") return;
    if (fenced) { out.push({ line: i + 1, text: raw }); return; }
    for (const m of raw.matchAll(INLINE)) out.push({ line: i + 1, text: m[1]! });
  });
  return out;
}

export function lintSkillText(text: string, file: string): LintHit[] {
  const hits: LintHit[] = [];
  for (const { line, text: code } of codeOn(text.split("\n"))) {
    if (KEPT_ON_BASH.some((k) => k.test(code))) continue;
    const rule = MCP_LINT_RULES.find((r) => r.pattern.test(code));
    if (rule) hits.push({ file, line, text: code.trim(), rule: rule.id, tool: rule.tool, note: rule.note });
  }
  return hits;
}

const LINTED_ROOTS = ["skills", "attachments", join("plugin", "skills")];

function walkLintedRoots(dir: string): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      const p = join(d, name);
      let isDir = false;
      try { isDir = lstatSync(p).isDirectory(); } catch { continue; }
      if (isDir) { if (name !== "node_modules" && name !== ".git") visit(p); } else out.push(p);
    }
  };
  for (const root of LINTED_ROOTS) {
    const p = join(dir, root);
    try { if (lstatSync(p).isDirectory()) visit(p); } catch { /* root absent */ }
  }
  return out;
}

function readOrNull(path: string): string | null {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

export type LintDeps = { list: (dir: string) => string[]; read: (path: string) => string | null };
const DISK: LintDeps = { list: walkLintedRoots, read: readOrNull };

/** Compiled output is skipped: its sources are linted already, and a hit there
    would point the author at a generated file the next compile rewrites. */
function lintedSources(dir: string, deps: LintDeps): Array<{ path: string; text: string }> {
  const roots = LINTED_ROOTS.map((r) => join(dir, r) + sep);
  const out: Array<{ path: string; text: string }> = [];
  for (const path of deps.list(dir).filter((p) => p.endsWith(".md") && roots.some((r) => p.startsWith(r))).sort()) {
    const text = deps.read(path);
    if (text !== null && !text.includes(HEADER_COMMENT)) out.push({ path, text });
  }
  return out;
}

export function lintedMarkdownFiles(dir: string, deps: LintDeps = DISK): string[] {
  return lintedSources(dir, deps).map((s) => s.path);
}

export function lintPackDir(dir: string, deps: LintDeps = DISK): LintHit[] {
  return lintedSources(dir, deps).flatMap((s) => lintSkillText(s.text, s.path));
}

export function formatHit(h: LintHit): string {
  return `${h.file}:${h.line}: \`${h.text}\` shells out for ${h.rule}; use the ${h.tool} tool (${h.note})`;
}
