import { randomUUID } from "crypto";
import { relative } from "path";
import { buildClaudeArgv } from "../lib/agent-argv/claude.ts";
import { resolveClaudeBin } from "../lib/claude-bin.ts";
import type { AgentInvocation } from "../lib/agent-argv/types.ts";
import { mcpToolsPayload } from "./mcp.ts";
import { checkPack, SkillsUsageError, type CheckPayload } from "./skills.ts";
import { lintedMarkdownFiles } from "../lib/skills/mcp-lint.ts";
import { runCapture } from "../lib/subprocess.ts";

const AUDIT_TIMEOUT_MS = 600_000;

// Paths only: a pack runs to tens of thousands of lines, and the prompt is
// one argv token, so inlining file text would hit ARG_MAX. The run reads the
// files itself (Read is the one tool it is allowed).
export function buildAuditPrompt(paths: string[], tools: Array<{ name: string; description: string }>): string {
  const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  const fileList = paths.map((p) => `- ${p}`).join("\n");
  return [
    "You are auditing a mattstack skill pack. Agents that load these skills run in Claude Code auto mode, where every shell command a tool could have covered costs a classifier round trip or is blocked outright.",
    "The mattstack MCP server publishes these tools:",
    toolList,
    "Read each file listed under Files with the Read tool (they are relative to your working directory), then report, as a Markdown list with one file:line per finding, three kinds of instruction that no pattern lint can catch:",
    "1. an instruction in plain words (\"push the branch\", \"open the MR\", \"rebase onto main\") that an agent will turn into a shell command a tool covers; name the tool;",
    "2. values carried between code blocks through shell variables ($IID, $RT_RUN_DB, read_token) instead of a tool result passed on explicitly;",
    "3. wrapped commands (cd x && ..., VAR=$(...), pipes, -C <tree>) around an rt, glab or git call.",
    "Anything on this kept list is fine and must not be reported: rt gate answer --by shepherd, rt gate wait, rt chat tail, rt events wait, git commit, git add, git fetch, git merge-base, git rebase --continue, git rebase --skip, project tooling such as pnpm. A line carrying <!-- mcp-lint: allow --> is a deliberate don't and must not be reported either.",
    "End with one line: `findings: <n>`.",
    "## Files",
    fileList,
  ].join("\n\n");
}

// The prompt is untrusted skill text telling the model to call MCP writes, so
// the run gets Read only, no MCP servers, and denies anything not allowed
// rather than inheriting the user's auto mode and base allow list. Each flag
// is one --flag=value token: a variadic option would swallow the prompt.
const AUDIT_LOCKDOWN = "--tools=Read --allowedTools=Read --strict-mcp-config --permission-mode=dontAsk --setting-sources=user";

export function buildAuditInvocation(prompt: string, sessionId: string): AgentInvocation {
  return { headless: true, prompt, session: { kind: "start", sessionId }, yolo: false, extraArgs: AUDIT_LOCKDOWN };
}

export function auditJsonPayload(
  resolved: { pack: string; packDir: string },
  files: string[],
  report: string,
  claudeExit: number,
): { pack: string; packDir: string; files: string[]; report: string; advisory: true; claudeExit: number } {
  return { pack: resolved.pack, packDir: resolved.packDir, files, report, advisory: true, claudeExit };
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export type AuditInputsResult =
  | { ok: true; resolved: CheckPayload; claude: string }
  | { ok: false; message: string };

/**
 * Everything skillsAudit needs before it spawns claude, as data rather than
 * thrown errors: checkPack's SkillsUsageError (unknown --pack, a --pack-dir
 * that does not exist, an ambiguous non-TTY pick) is exactly as much a
 * "no pack resolves" outcome as the no-flags case, so it is caught here
 * rather than left to crash the process with a stack trace. Anything else
 * checkPack throws is a real bug and propagates.
 */
export async function resolveAuditInputs(
  args: string[],
  resolveClaude: () => string | null = resolveClaudeBin,
): Promise<AuditInputsResult> {
  const pack = flag(args, "--pack");
  const packDir = flag(args, "--pack-dir");
  if (!pack && !packDir) return { ok: false, message: "rt skills audit: pass --pack <name> or --pack-dir <dir>" };
  let resolved: CheckPayload;
  try {
    resolved = await checkPack({ ...(pack ? { pack } : {}), ...(packDir ? { packDir } : {}) });
  } catch (err) {
    if (err instanceof SkillsUsageError) return { ok: false, message: `rt skills audit: ${err.message}` };
    throw err;
  }
  const claude = resolveClaude();
  if (!claude) return { ok: false, message: "rt skills audit: no claude binary on PATH; the audit needs a Claude login" };
  return { ok: true, resolved, claude };
}

export async function skillsAudit(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const inputs = await resolveAuditInputs(args);
  if (!inputs.ok) { console.error(inputs.message); process.exit(2); }
  const { resolved, claude } = inputs;
  const files = lintedMarkdownFiles(resolved.packDir).map((p) => relative(resolved.packDir, p));
  const prompt = buildAuditPrompt(files, mcpToolsPayload().tools.map((t) => ({ name: t.name, description: t.description })));
  const argv = buildClaudeArgv(buildAuditInvocation(prompt, randomUUID()), { claude });
  const r = await runCapture(argv as [string, ...string[]], { cwd: resolved.packDir, timeoutMs: AUDIT_TIMEOUT_MS, stderr: "pipe" });
  let text = r.stdout;
  try {
    const parsed = JSON.parse(r.stdout) as { result?: string };
    if (typeof parsed.result === "string") text = parsed.result;
  } catch {
    // claude printed plain text, not the -p --output-format json envelope
  }
  if (r.exitCode !== 0) console.error(`rt skills audit: claude exited ${r.exitCode}: ${r.stderr.trim().split("\n").slice(-3).join(" ")}`);
  if (json) { console.log(JSON.stringify(auditJsonPayload(resolved, files, text, r.exitCode))); return; }
  console.log(`rt skills audit (advisory; never a gate): ${resolved.pack}\n`);
  console.log(text);
}
