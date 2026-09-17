import { createGitClient } from "../../packages/git-core/src/index.ts";
import { flagValue } from "../../lib/cli-args.ts";

export function failPlain(json: boolean, verb: string, message: string): never {
  if (json) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`rt ${verb}: ${message}`);
  process.exit(1);
}

export function repoClient() {
  return createGitClient(process.cwd());
}

export async function statusCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  try {
    const snap = await repoClient().snapshot();
    if (json) {
      console.log(JSON.stringify({ ok: true, ...snap }));
      return;
    }
    const head = snap.detached ? "(detached)" : snap.branch ?? "(unborn)";
    const pos = [
      snap.ahead ? `ahead ${snap.ahead}` : "",
      snap.behind ? `behind ${snap.behind}` : "",
    ].filter(Boolean).join(", ");
    console.log(`${head}${snap.upstream ? ` -> ${snap.upstream}` : ""}${pos ? `  [${pos}]` : ""}`);
    if (snap.clean) {
      console.log("clean");
      return;
    }
    for (const f of snap.files) {
      const marks = `${f.staged ? "S" : " "}${f.unstaged ? "W" : " "}`;
      console.log(`  ${marks} ${f.kind.padEnd(10)} ${f.path}${f.originalPath ? ` (from ${f.originalPath})` : ""}`);
    }
  } catch (err) {
    failPlain(json, "git status", err instanceof Error ? err.message : String(err));
  }
}

export async function logCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const max = Number(flagValue(args, "--max") ?? 20);
  const file = flagValue(args, "--file") ?? undefined;
  try {
    const entries = await repoClient().log({
      maxCount: Number.isFinite(max) && max > 0 ? max : 20,
      ...(file ? { file } : {}),
    });
    if (json) {
      console.log(JSON.stringify({ ok: true, entries }));
      return;
    }
    for (const e of entries) {
      console.log(`${e.sha.slice(0, 8)}  ${e.authorDate.slice(0, 10)}  ${e.subject}`);
    }
  } catch (err) {
    failPlain(json, "git log", err instanceof Error ? err.message : String(err));
  }
}

export async function branchesCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  try {
    const branches = await repoClient().branches();
    if (json) {
      console.log(JSON.stringify({ ok: true, branches }));
      return;
    }
    for (const b of branches) {
      const pos = [
        b.ahead ? `ahead ${b.ahead}` : "",
        b.behind ? `behind ${b.behind}` : "",
        b.upstreamGone ? "upstream gone" : "",
      ].filter(Boolean).join(", ");
      console.log(`${b.current ? "*" : " "} ${b.name}${b.upstream ? ` -> ${b.upstream}` : ""}${pos ? `  [${pos}]` : ""}`);
    }
  } catch (err) {
    failPlain(json, "git branches", err instanceof Error ? err.message : String(err));
  }
}

const DIFF_USAGE = "usage: rt git diff <path> [--staged] [--json]";

function positional(args: string[]): string | undefined {
  const flagsWithValue = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (flagsWithValue.has(a)) { i++; continue; }
    if (!a.startsWith("-")) return a;
  }
  return undefined;
}

export async function diffCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const staged = args.includes("--staged");
  const client = repoClient();
  let path = positional(args);
  let untracked = false;
  try {
    if (!path && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
      const files = (await client.snapshot()).files;
      if (files.length === 0) failPlain(json, "git diff", DIFF_USAGE);
      const { filterableSelect } = await import("../../lib/pick-wrappers.ts");
      const picked = await filterableSelect({
        message: "Diff which file?",
        options: files.map((f) => ({ label: f.path, value: f.path, hint: f.kind })),
      });
      if (picked === null) process.exit(0);
      path = picked;
      untracked = files.find((f) => f.path === picked)?.kind === "untracked";
    }
    if (!path) failPlain(json, "git diff", DIFF_USAGE);
    const diff = await client.diffFile(path, { staged, ...(untracked ? { untracked: true } : {}) });
    if (json) {
      console.log(JSON.stringify({ ok: true, diff }));
      return;
    }
    if (diff.kind !== "text") {
      console.log(`${diff.path}: ${diff.kind} (no line diff)`);
      return;
    }
    for (const hunk of diff.hunks) {
      console.log(hunk.header);
      for (const line of hunk.lines) {
        const mark = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
        console.log(`${mark}${line.content}`);
      }
    }
  } catch (err) {
    failPlain(json, "git diff", err instanceof Error ? err.message : String(err));
  }
}
