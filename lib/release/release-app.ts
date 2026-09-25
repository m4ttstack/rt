/**
 * rt release app <name>... a single served-app patch release end to end:
 * qualify origin/main for the pin-only fast path, bump the app on apps main,
 * run bundle-apps, verify and merge its deps.lock PR, write and commit the
 * notes, tag, and verify the publish.
 *
 * Every step first detects whether it already happened, so a rerun after a
 * failure resumes where the last one stopped. Every external effect goes
 * through ReleaseAppSeams; the real seams live in commands/release.ts.
 */
import { classifyRows, compareVersions, keepsFastPath, type DepsRow } from "./preflight.ts";

export const APPS_REPO = "m4ttstack/apps";
export const RT_REPO = "m4ttstack/rt";
const LOCK_PATH = "rt-tray/deps.lock";

export type Phase = "bump" | "bundle" | "notes" | "released";

export type PhaseDecision = { phase: Phase; target: string } | { refuse: string };

export function appAssetUrl(name: string, version: string): string {
  return `https://github.com/${APPS_REPO}/releases/download/${name}-v${version}/${name}-darwin-arm64.tgz`;
}

export function appTagFor(name: string, version: string): string {
  return `${name}-v${version}`;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function bumpPatch(version: string): string {
  const m = version.match(SEMVER);
  if (!m) throw new Error(`version ${version} is not X.Y.Z; bump it by hand`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

export function nextPatchTag(tag: string): string {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`last tag ${tag} is not vX.Y.Z`);
  return `v${bumpPatch(tag.slice(1))}`;
}

/** Rewrites the top-level version in place so the rest of package.json keeps its exact bytes. */
export function setPackageVersion(text: string, from: string, to: string): string {
  const re = /("version"\s*:\s*")([^"\\]*)(")/;
  const m = text.match(re);
  if (!m) throw new Error(`package.json has no "version" field`);
  if (m[2] !== from) throw new Error(`package.json is at ${m[2]}, expected ${from}`);
  const out = text.replace(re, (_all, open: string, _v: string, close: string) => `${open}${to}${close}`);
  if ((JSON.parse(out) as { version?: unknown }).version !== to) {
    throw new Error(`package.json's first "version" key is not its top-level version; bump it by hand`);
  }
  return out;
}

export function eligibleApps(rows: DepsRow[]): DepsRow[] {
  return classifyRows(rows).apps.filter((r) => keepsFastPath(r.name));
}

export function qualifyRow(name: string, rows: DepsRow[]): DepsRow {
  const eligible = eligibleApps(rows).map((r) => r.name).join(", ");
  const row = rows.find((r) => r.name === name);
  if (!row) throw new Error(`no ${LOCK_PATH} row named "${name}"; eligible apps: ${eligible}`);
  if (!classifyRows([row]).apps.length) {
    throw new Error(`${name} is not an apps-monorepo row in ${LOCK_PATH}; eligible apps: ${eligible}`);
  }
  if (!keepsFastPath(name)) {
    throw new Error(`${name}'s pin keeps the full gate (the walkthrough gates it), so it cannot ship on the fast path; cut it with the full /rt:release`);
  }
  return row;
}

/**
 * Where a run starts, read from remote state alone: `pinned` is origin/main's
 * pin, `shipped` the last v* tag's, `shippedBefore` the tag before that's, and
 * `appsMain` apps main's package.json version.
 */
export async function resolvePhase(o: {
  name: string;
  pinned: string;
  shipped: string;
  shippedBefore: string | null;
  appsMain: string;
  pinTag: string;
  appMoved: () => Promise<boolean>;
}): Promise<PhaseDecision> {
  const ahead = compareVersions(o.appsMain, o.pinned);
  if (ahead < 0) {
    return { refuse: `apps main has ${o.name} ${o.appsMain}, behind the pin ${o.pinned}; fix apps/${o.name}/package.json by hand` };
  }
  if (ahead > 0) return { phase: "bundle", target: o.appsMain };
  if (o.pinned !== o.shipped) return { phase: "notes", target: o.pinned };
  if (await o.appMoved()) return { phase: "bump", target: bumpPatch(o.pinned) };
  if (o.shippedBefore !== null && o.shippedBefore !== o.shipped) return { phase: "released", target: o.pinned };
  return { refuse: `nothing to release: no commits under apps/${o.name} since ${o.pinTag}` };
}

interface Lock {
  tools: DepsRow[];
  [key: string]: unknown;
}

export function checkBotPrLock(o: {
  name: string;
  version: string;
  files: string[];
  baseLock: string;
  headLock: string;
}): { row: DepsRow | null; problems: string[] } {
  const problems: string[] = [];
  const extra = o.files.filter((f) => f !== LOCK_PATH);
  if (extra.length) problems.push(`touches files besides ${LOCK_PATH}: ${extra.join(", ")}`);

  let base: Lock;
  let head: Lock;
  try {
    base = JSON.parse(o.baseLock) as Lock;
    head = JSON.parse(o.headLock) as Lock;
  } catch (err) {
    return { row: null, problems: [...problems, `deps.lock does not parse: ${String((err as Error).message ?? err)}`] };
  }

  const { tools: baseTools, ...baseTop } = base;
  const { tools: headTools, ...headTop } = head;
  if (JSON.stringify(baseTop) !== JSON.stringify(headTop)) problems.push("changes deps.lock's top-level fields");

  const baseRows = new Map(baseTools.map((r) => [r.name, r]));
  const headRows = new Map(headTools.map((r) => [r.name, r]));
  const others = [...new Set([...baseRows.keys(), ...headRows.keys()])]
    .filter((n) => n !== o.name && JSON.stringify(baseRows.get(n)) !== JSON.stringify(headRows.get(n)));
  if (others.length) problems.push(`rows other than ${o.name} changed: ${others.join(", ")}`);

  const row = headRows.get(o.name) ?? null;
  if (!row) {
    problems.push(`has no ${o.name} row`);
    return { row, problems };
  }
  if (row.version !== o.version) problems.push(`pins ${o.name} ${row.version}, expected ${o.version}`);
  const url = appAssetUrl(o.name, o.version);
  if (row.url !== url) problems.push(`pins url ${row.url}, expected ${url}`);
  if (!/^[0-9a-f]{64}$/.test(row.sha256 ?? "")) problems.push(`has no sha256 on the ${o.name} row`);
  return { row, problems };
}

export function checkCodesign(name: string, output: string): string[] {
  const lines = output.split("\n").map((l) => l.trim());
  const want = `com.mattstack.helper.${name}`;
  const id = lines.find((l) => l.startsWith("Identifier="))?.slice("Identifier=".length);
  const problems: string[] = [];
  if (id !== want) problems.push(`codesign Identifier is ${id ?? "missing"}, expected ${want}`);
  if (!lines.some((l) => l.startsWith("Authority=Developer ID Application"))) {
    problems.push("codesign shows no Developer ID Application authority (ad-hoc or unsigned)");
  }
  return problems;
}

export type ChecksVerdict =
  | { state: "green" }
  | { state: "pending"; pending: string[] }
  | { state: "failed"; failed: string[] };

/** Merge-on-green: zero pending and at least one pass, any fail blocks. CodeRabbit never counts either way. */
export function evaluateChecks(checks: { name: string; bucket: string }[]): ChecksVerdict {
  const relevant = checks.filter((c) => !/coderabbit/i.test(c.name));
  const failed = relevant.filter((c) => c.bucket === "fail" || c.bucket === "cancel").map((c) => c.name);
  if (failed.length) return { state: "failed", failed };
  const pending = relevant.filter((c) => c.bucket === "pending").map((c) => c.name);
  if (pending.length || !relevant.some((c) => c.bucket === "pass")) return { state: "pending", pending };
  return { state: "green" };
}

const DASHES = new RegExp(`\\s*[${String.fromCharCode(0x2013, 0x2014)}]\\s*`, "g");

/** Bare #123 in an rt release body would link to rt's PR 123, not the apps PR the subject means. */
export function noteSubject(subject: string): string {
  return subject.trim().replace(/(^|[\s(])#(\d+)\b/g, `$1${APPS_REPO}#$2`).replace(DASHES, "... ");
}

export interface NotesSection {
  app: string;
  version: string;
  subjects: string[];
}

function listJoin(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function renderNotes(o: { sections: NotesSection[]; lastTag: string; nextTag: string }): string {
  const lines = [`A patch release that ships ${listJoin(o.sections.map((s) => `${s.app} ${s.version}`))}.`, ""];
  for (const s of o.sections) {
    lines.push(`### ${s.app.charAt(0).toUpperCase()}${s.app.slice(1)} ${s.version}`, "");
    const bullets = s.subjects.length ? s.subjects.map(noteSubject) : [`version bump only; no other commits under apps/${s.app}`];
    lines.push(...bullets.map((b) => `- ${b}`), "");
  }
  lines.push(`**Full Changelog**: https://github.com/${RT_REPO}/compare/${o.lastTag}...${o.nextTag}`, "");
  return lines.join("\n");
}
