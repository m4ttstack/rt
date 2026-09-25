import { changeNoun } from "../../repo-label.ts";
import type { Containment } from "../containment.ts";
import type { DirtClass, DirtKind } from "../dirt-class.ts";
import type { KeepRecord } from "../registry.ts";
import { keepStillHolds, type Fingerprint } from "./fingerprint.ts";

export type BrokenKind = "gone" | "unlinked";
export type TriageGroup ="safe" | "look" | "only-copy" | "waiting" | "broken" | "kept";
export type TriageAction = "dispose" | "review" | "push-branch" | "keep" | "unkeep" | "stop-process"
  | "open-herd" | "open-run" | "remove" | "open-finder" | "open-terminal" | "copy-path";
export type PushKind = "pushed" | "in-main" | "remote-deleted" | "unpushed";
export interface TriageHold { kind: "process" | "orphan-stopping" | "herd" | "run"; detail: string }
export interface TriageFacts {
  repo: string; tree: string; path: string; branch: string | null;
  /** "gone": the folder itself is missing. "unlinked": the folder is there but its git link is not. */
  broken: BrokenKind | null;
  mr: { iid: number; state: "opened" | "merged" | "closed"; title: string; at: string | null; url: string | null } | null;
  ticket: { identifier: string; title: string; stateName: string | null; url: string | null } | null;
  remoteBranchExists: boolean; ahead: number;
  containment: Containment; dirt: DirtClass; fingerprint: Fingerprint;
  kept: KeepRecord | null; hold: TriageHold | null;
}
export interface TriageRow {
  repo: string; tree: string; path: string; branch: string | null;
  mr: TriageFacts["mr"]; ticket: TriageFacts["ticket"];
  push: { kind: PushKind; ahead?: number };
  containment: Containment; dirt: { kind: DirtKind; files: string[] };
  group: TriageGroup; verdict: string; actions: TriageAction[];
  hold?: TriageHold; keptAt?: string; fingerprint: Fingerprint;
}
export interface TriageCounts { needsDecision: number; safe: number; waiting: number; kept: number }

const TAIL: TriageAction[] = ["open-finder", "open-terminal", "copy-path"];

function pushOf(f: TriageFacts): TriageRow["push"] {
  if (f.containment === "in-default") return { kind: "in-main" };
  if (f.containment === "on-remote") return { kind: "pushed" };
  if (f.containment === "patch-identical" || f.containment === "in-merged-mr") return { kind: f.remoteBranchExists ? "pushed" : "remote-deleted" };
  return { kind: "unpushed", ahead: f.ahead };
}

function groupOf(f: TriageFacts): TriageGroup {
  if (f.broken) return "broken";
  if (f.kept && keepStillHolds(f.kept, f.fingerprint)) return "kept";
  if (f.hold) return "waiting";
  if (f.containment === "none") return "only-copy";
  if (f.dirt.kind === "real") return "look";
  return "safe";
}

function safeVerdict(f: TriageFacts): string {
  const noun = changeNoun(f.repo);
  const where = f.containment === "in-default" ? "Every commit is in main."
    : f.containment === "patch-identical" ? `Rebased before merge, and all ${f.ahead} commits match the merged ${noun}.`
    : f.containment === "in-merged-mr" ? `Every commit is in the merged ${noun}.`
    : f.mr?.state === "closed" ? `The ${noun} was closed, but the remote branch has every commit.`
    : "Every commit is on the remote.";
  if (f.dirt.kind === "junk") return `${where} Only generated files are left.`;
  if (f.dirt.kind === "lockfile") return `${where} Only bun.lock changed, rewritten by install.`;
  return where;
}

function verdictOf(f: TriageFacts, group: TriageGroup): string {
  switch (group) {
    case "broken": return f.broken === "unlinked"
      ? "Its git link is broken. The folder still has files; Remove moves it to the trash."
      : "Its folder is gone. Nothing to recover.";
    case "kept": return "Kept. Comes back here if it changes.";
    case "waiting": return `Waiting: ${f.hold!.detail.trimEnd().replace(/\.$/, "")}.`;
    case "only-copy": return "Only copy of this work. Push the branch to keep it, or dispose to drop it.";
    case "look": return `${f.dirt.files.length === 1 ? "One uncommitted file" : `${f.dirt.files.length} uncommitted files`}: ${f.dirt.files.slice(0, 2).join(", ")}. Review before disposing.`;
    case "safe": return safeVerdict(f);
  }
}

function actionsOf(f: TriageFacts, group: TriageGroup): TriageAction[] {
  switch (group) {
    case "broken": return ["remove", "copy-path"];
    case "kept": return ["unkeep", ...TAIL];
    case "waiting": {
      const lead: Record<TriageHold["kind"], TriageAction[]> = { process: ["stop-process"], herd: ["open-herd"], run: ["open-run"], "orphan-stopping": [] };
      return [...lead[f.hold!.kind], ...TAIL];
    }
    case "only-copy": return ["push-branch", "keep", ...TAIL];
    case "look": return ["review", "keep", ...TAIL];
    case "safe": return ["dispose", "keep", ...TAIL];
  }
}

export function triageRow(f: TriageFacts): TriageRow {
  const group = groupOf(f);
  return {
    repo: f.repo, tree: f.tree, path: f.path, branch: f.branch, mr: f.mr, ticket: f.ticket,
    push: pushOf(f), containment: f.containment, dirt: { kind: f.dirt.kind, files: f.dirt.files },
    group, verdict: verdictOf(f, group), actions: actionsOf(f, group),
    ...(group === "waiting" && f.hold ? { hold: f.hold } : {}),
    ...(group === "kept" && f.kept ? { keptAt: f.kept.keptAt } : {}),
    fingerprint: f.fingerprint,
  };
}

export function triageCounts(rows: TriageRow[]): TriageCounts {
  const n = (g: TriageGroup) => rows.filter((r) => r.group === g).length;
  return { needsDecision: n("safe") + n("look") + n("only-copy") + n("broken"), safe: n("safe"), waiting: n("waiting"), kept: n("kept") };
}
