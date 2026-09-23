import { existsSync, statSync } from "fs";
import { isAbsolute } from "path";
import { TREE } from "../command-tree-def.ts";
import type { CommandArg, CommandNode } from "../command-tree.ts";
import { listAgentSafe, resolveLeaf } from "../command-tree-resolve.ts";
import { rtSelfArgv } from "../rt-self.ts";
import { execWithTimeout, type ExecResult } from "../setup/probes.ts";

export const RT_VERB_TIMEOUT_MS = 30_000;
const TAIL_BYTES = 400;

export interface RtVerbDeps {
  tree: Record<string, CommandNode>;
  selfArgv: () => string[];
  isDir: (path: string) => boolean;
  spawn: (argv: string[], opts: { cwd?: string; env: Record<string, string>; timeoutMs: number }) => Promise<ExecResult>;
}

export function realRtVerbDeps(): RtVerbDeps {
  return {
    tree: TREE,
    selfArgv: () => rtSelfArgv(),
    isDir: (p) => existsSync(p) && statSync(p).isDirectory(),
    spawn: (argv, opts) => execWithTimeout(argv, opts),
  };
}

type RtVerbResult = { ok: true; body: unknown } | { ok: false; error: string };

const fail = (error: string): RtVerbResult => ({ ok: false, error });

function tail(text: string): string {
  const t = text.trim();
  return t.length > TAIL_BYTES ? `...${t.slice(-TAIL_BYTES)}` : t;
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function errorText(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  const e = (value as { error: unknown }).error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") return (e as { message: string }).message;
  return null;
}

export async function runRtVerb(input: { args?: unknown; cwd?: unknown }, deps: RtVerbDeps = realRtVerbDeps()): Promise<RtVerbResult> {
  const { args } = input;
  if (!Array.isArray(args) || args.length === 0 || !args.every((a) => typeof a === "string")) {
    return fail("args must be a non-empty array of strings, without the leading rt");
  }
  const allowed = `Agent-safe verbs: ${listAgentSafe(deps.tree).map((e) => e.path.join(" ")).join(", ")}`;
  // cli.ts matches --daemon, --post-install, --grant-fda and --version only at args[0].
  if (args[0]!.startsWith("-")) return fail(`args[0] must name a verb, not a flag. ${allowed}`);

  const leaf = resolveLeaf(deps.tree, args);
  if (!leaf || leaf.node.subcommands || !leaf.node.agentSafe) return fail(`"${args.join(" ")}" is not an agent-safe rt verb. ${allowed}`);

  const verb = `rt ${leaf.path.join(" ")}`;
  const flagTypes = new Map<string, CommandArg["type"]>();
  for (const a of leaf.node.args ?? []) if (a.flag) flagTypes.set(a.flag, a.type);
  flagTypes.set("--json", "boolean");
  const declared = `Declared flags: ${[...flagTypes.keys()].join(", ")}`;
  const forwarded: string[] = [];
  for (const arg of leaf.rest) {
    if (!arg.startsWith("-")) {
      forwarded.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq < 0 ? arg : arg.slice(0, eq);
    const type = flagTypes.get(name);
    if (!type) return fail(`${verb} does not declare ${name}. ${declared}`);
    if (eq < 0) {
      forwarded.push(arg);
      continue;
    }
    // Some verbs parse only `--name value` and silently ignore `--name=value`, so it is split here.
    if (type === "boolean") return fail(`${name} is a switch and takes no value; pass it as ${name}`);
    const value = arg.slice(eq + 1);
    if (value.startsWith("-")) return fail(`the value of ${name} must not start with "-"`);
    forwarded.push(name, value);
  }

  let cwd: string | undefined;
  if (input.cwd !== undefined) {
    if (typeof input.cwd !== "string" || !isAbsolute(input.cwd) || !deps.isDir(input.cwd)) {
      return fail("cwd must be an absolute path to an existing directory");
    }
    cwd = input.cwd;
  }

  const rest = forwarded.includes("--json") ? forwarded : [...forwarded, "--json"];
  const res = await deps.spawn([...deps.selfArgv(), ...leaf.path, ...rest], {
    cwd,
    env: { RT_BATCH: "1", RT_SKIP_SETUP: "1" },
    timeoutMs: RT_VERB_TIMEOUT_MS,
  });

  const parsed = parseJson(res.stdout);
  if (res.code === 0) return parsed.ok ? { ok: true, body: parsed.value } : fail(`${verb} returned non-JSON output: ${tail(res.stdout)}`);
  if (res.code === 124) return fail(`${verb} timed out after ${RT_VERB_TIMEOUT_MS / 1000}s`);
  const envelopeMessage = parsed.ok ? errorText(parsed.value) : null;
  if (res.code === 2 && envelopeMessage) return fail(envelopeMessage);
  const detail = envelopeMessage ?? (tail(res.stderr) || tail(res.stdout));
  return fail(`${verb} failed (exit ${res.code})${detail ? `: ${detail}` : ""}`);
}
