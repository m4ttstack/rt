export const CONTRACT_VERSION = 1 as const;

export type RowStatus = "ready" | "missing" | "invalid" | "needs-you" | "checking" | "skipped" | "error";
export type RowKind = "permission" | "tool" | "account" | "access" | "info";
export type Recheck = "on-activate" | "on-change" | "manual";
export type GroupId = "mac" | "accounts" | "access" | "tools";
export type Integration = "github" | "gitlab" | "linear" | "slack" | "switchboard" | "sdm" | "doppler" | "ldcli";

export interface ConnectField {
  name: string;
  label: string;
  secret: boolean;
  hint?: string;
}

export type Action =
  | { type: "open-settings"; label: string; target: "fda" | "login-items" | "notifications" | "keyboard" }
  | { type: "request-permission"; label: string; which: "notifications" }
  | { type: "connect"; label: string; integration: Integration; fields: ConnectField[]; alternatives?: { id: string; label: string }[] }
  | { type: "oauth"; label: string; integration: Integration; verb: string[] }
  | { type: "owner-once"; label: string; integration: Integration; fields: ConnectField[] }
  | { type: "install"; label: string; tool: string; via: "brew" | "vendor" | "apple-clt" | "bundled-link" }
  | { type: "link-bundled"; label: string; tool: string }
  | { type: "steps"; label: string; steps: string[] }
  | { type: "open-url"; label: string; url: string }
  | { type: "run"; label: string; verb: string[] };

export interface Row {
  id: string;
  kind: RowKind;
  title: string;
  why: string;
  required: boolean;
  optionalNote: string | null;
  status: RowStatus;
  detail: string;
  action: Action | null;
  recheck: Recheck;
  /** Blocks the wizard's Finish (never Install) until ready, skipped, or waived on this Mac. */
  finishGated?: boolean;
  /** Set on a finish-gated row the user skipped on this Mac; the app's Un-skip affordance keys on this, never on the note's wording. */
  waived?: boolean;
}

export interface Group {
  id: GroupId;
  title: string;
  rows: Row[];
}

export type TeamMode = "join" | "create" | "restore" | "none";

export interface TeamRef {
  slug: string;
  name: string;
  mode: TeamMode;
}

export interface Plan {
  contract: 1;
  at: string;
  team: TeamRef;
  groups: Group[];
  canInstall: boolean;
  requiredMissing: string[];
  finishBlockedBy: string[];
}

export const GROUP_TITLES: Record<GroupId, string> = { mac: "Your Mac", accounts: "Accounts", access: "Access", tools: "Tools" };

/** The rows that gate Finish. Enumerated here so `rt setup waive` can refuse anything else and offer a picker over the set. */
export const FINISH_GATED_ROW_IDS: readonly string[] = ["tool.fast-browser-extension"];

export type StepKind = "rt" | "app" | "privileged";
export type StepState = "pending" | "running" | "done" | "failed" | "skipped";

export const STEP_IDS = [
  "home.init",
  "home.restore",
  "team.create",
  "team.join",
  "secrets.write",
  "git.identity",
  "path.link",
  "settings.seed",
  "repos.clone",
  "services.register",
  "proxy.install",
  "deck.managed",
  "skills.materialize",
  "skills.link",
  "board.keys",
  "cron.triage",
  "intercepts.install",
  "plugins.install",
  "linear.mcp",
  "fastbrowser.setup",
  "herdr.integration",
  "extension.install",
  "services.start",
  "snapshot.push",
  "verify",
] as const;
export type StepId = (typeof STEP_IDS)[number];

export type NeedRequest =
  | { type: "app-register-services"; plists: string[] }
  | { type: "app-unregister-services"; plists: string[] }
  | { type: "app-privileged"; op: "proxy-install" | "proxy-remove" | "proxy-trust" };

/** Uninstall streams the same event shapes with these ids (contract §uninstall: "NDJSON like apply"). */
export type UninstallActionId = "services.unregister" | "deck.managed-remove" | "proxy.remove" | "path.unlink" | "shell.remove" | "extension.uninstall" | "plugins.uninstall" | "cron.uninstall" | "data" | "app.trash";

export type EventId = StepId | UninstallActionId;

export type ApplyEvent =
  | { event: "plan"; steps: { id: EventId; title: string; kind: StepKind }[] }
  | { event: "step"; id: EventId; state: StepState; detail?: string; remedy?: string }
  | { event: "log"; id: EventId; line: string }
  | { event: "need"; id: EventId; request: NeedRequest }
  | { event: "done"; ok: boolean; failedStep?: EventId };

export function envelope<T extends object>(body: T, now: Date = new Date()): T & { contract: 1; at: string } {
  return { contract: CONTRACT_VERSION, at: now.toISOString(), ...body };
}

export function row(r: Omit<Row, "optionalNote" | "action" | "recheck"> & Partial<Pick<Row, "optionalNote" | "action" | "recheck">>): Row {
  return { optionalNote: null, action: null, recheck: "on-change", ...r };
}

/** A finish-gated row that is neither ready nor skipped, and not waived on this Mac, blocks Finish. `skipped` means there is nothing to load into, or another row already reports the fault. */
export function finishBlockers(groups: Group[], waived: readonly string[] = []): string[] {
  return groups.flatMap((g) =>
    g.rows.filter((r) => r.finishGated === true && r.status !== "ready" && r.status !== "skipped" && !waived.includes(r.id)).map((r) => r.id),
  );
}

/** Install enables only when every required row is ready; requiredMissing lists the others in group order. A finish-gated row is Finish's concern whatever its `required` reads, so it never lands here. */
export function finalizePlan(team: TeamRef, groups: Group[], now: Date = new Date(), waived: readonly string[] = []): Plan {
  const requiredMissing = groups.flatMap((g) => g.rows.filter((r) => r.required && !r.finishGated && r.status !== "ready").map((r) => r.id));
  return envelope({ team, groups, canInstall: requiredMissing.length === 0, requiredMissing, finishBlockedBy: finishBlockers(groups, waived) }, now);
}
