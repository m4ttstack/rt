/**
 * rt release preflight — the release's mechanical checks (rt:release skill
 * steps 1-2c) as one read-only report: git/tag state, picker conformance,
 * settings schema lock, the candidate's settings check against the real
 * stores, per-layer pin freshness across every vendored surface, catalog pin
 * drift, extension currency, rt-client npm-vs-source parity, and the gate
 * (fast vs full) the pending diff implies.
 *
 * Read-only by contract: the catalog check re-resolves refs with
 * `git ls-remote` itself because `marketplace.sh --refresh` rewrites
 * marketplace.json in place (its --dry-run flag gates only the publish path).
 */
import { join } from "path";
import { checkLockAgainst, isMissingPathAtRef, type Lock } from "../settings/schema-diff.ts";
import type { RunResult } from "../subprocess.ts";

export interface DepsRow {
  name: string;
  version: string;
  url: string;
  sha256?: string;
  repo?: string;
  subdir?: string;
  status?: string;
  serve?: unknown;
}

export type RowStatus = "ok" | "stale" | "error";

export interface CheckRow {
  id: string;
  label: string;
  status: RowStatus;
  pinned?: string;
  current?: string;
  detail?: string;
}

export interface GateImplication {
  path: "fast" | "full";
  reason: string;
}

export interface PreflightReport {
  tag: string | null;
  commitsSinceTag: number | null;
  gate: GateImplication | null;
  rows: CheckRow[];
  staleCount: number;
  errorCount: number;
  clean: boolean;
}

export interface PreflightSeams {
  repoRoot: string;
  exec(argv: [string, ...string[]], opts?: { cwd?: string; timeoutMs?: number }): Promise<RunResult>;
  fetchJson(url: string): Promise<unknown>;
  readFile(path: string): string | null;
  violations(): { path: string }[];
}

/** Rows deck merely serves; a pin-only diff limited to these keeps the fast path (user-ratified 2026-09-18). */
const SERVE_ONLY_ROWS = new Set(["board", "chat", "console", "gitq", "boxscore"]);

/** Whether moving this row's pin alone keeps a release on the fast path. */
export function keepsFastPath(name: string): boolean {
  return SERVE_ONLY_ROWS.has(name);
}

/** Numeric per-segment semver compare; non-numeric segments fall back to string order. */
export function compareVersions(a: string, b: string): number {
  const as = a.split(".");
  const bs = b.split(".");
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i] ?? "0";
    const y = bs[i] ?? "0";
    const xn = Number(x);
    const yn = Number(y);
    const cmp = Number.isNaN(xn) || Number.isNaN(yn) ? x.localeCompare(y) : xn - yn;
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/** Standalone app rows live in their own repos; fast-browser's deps.lock url is npm, so its repo is declared here. */
const STANDALONE_REPOS: Record<string, string> = {
  gitq: "m4ttstack/gitq",
  "fast-browser": "m4ttstack/fast-browser",
};

const EXTENSION_LOCK_REPO = "m4ttstack/fast-browser";
const EXTENSION_FORK_REPO = "m4ttheweric/playwright";
const EXTENSION_TAG_PREFIX = "fast-browser-v";

export function normalizeVersion(tag: string): string {
  return tag.trim().replace(/^.*?v?(\d+\.\d+)/, "$1").replace(/^v/, "") || tag.trim();
}

export function pinnedTagFromUrl(url: string): string | null {
  const m = url.match(/\/releases\/download\/([^/]+)\//);
  return m ? m[1]! : null;
}

export function classifyRows(rows: DepsRow[]): { apps: DepsRow[]; standalone: DepsRow[]; tools: DepsRow[] } {
  const apps: DepsRow[] = [];
  const standalone: DepsRow[] = [];
  const tools: DepsRow[] = [];
  for (const r of rows) {
    if (r.repo === "m4ttstack/apps" && r.subdir) apps.push(r);
    else if (r.name in STANDALONE_REPOS) standalone.push(r);
    else tools.push(r);
  }
  return { apps, standalone, tools };
}

export type ToolUpstream =
  | { kind: "github"; repo: string }
  | { kind: "node-lts" }
  | { kind: "npm"; pkg: string }
  | { kind: "gitlab"; project: string };

export function upstreamForToolRow(row: DepsRow): ToolUpstream | null {
  const gh = row.url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\//);
  if (gh) return { kind: "github", repo: gh[1]! };
  if (row.url.startsWith("https://nodejs.org/dist/")) return { kind: "node-lts" };
  const npm = row.url.match(/^https:\/\/registry\.npmjs\.org\/(.+?)\/-\//);
  if (npm) return { kind: "npm", pkg: npm[1]! };
  const gl = row.url.match(/^https:\/\/gitlab\.com\/api\/v4\/projects\/([^/]+)\//);
  if (gl) return { kind: "gitlab", project: gl[1]! };
  return null;
}

function readDepsRows(seams: Pick<PreflightSeams, "repoRoot" | "readFile">): DepsRow[] {
  const raw = seams.readFile(join(seams.repoRoot, "rt-tray", "deps.lock"));
  if (!raw) throw new Error("rt-tray/deps.lock not readable — is this an rt checkout?");
  return (JSON.parse(raw) as { tools: DepsRow[] }).tools;
}

async function git(seams: Pick<PreflightSeams, "repoRoot" | "exec">, args: string[]): Promise<string> {
  const r = await seams.exec(["git", ...args] as [string, ...string[]], { cwd: seams.repoRoot });
  if (r.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

async function ghApi(seams: PreflightSeams, path: string, jq?: string): Promise<string> {
  const argv: [string, ...string[]] = jq ? ["gh", "api", path, "--jq", jq] : ["gh", "api", path];
  const r = await seams.exec(argv, { timeoutMs: 30_000 });
  if (r.exitCode !== 0) throw new Error(`gh api ${path} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

export async function checkGitState(
  seams: PreflightSeams,
): Promise<{ row: CheckRow; tag: string | null; commitsSinceTag: number | null }> {
  try {
    const branch = (await git(seams, ["branch", "--show-current"])).trim();
    const porcelain = (await git(seams, ["status", "--porcelain"])).trim();
    const tag = (await git(seams, ["describe", "--tags", "--abbrev=0"])).trim();
    const count = Number((await git(seams, ["rev-list", `${tag}..HEAD`, "--count"])).trim());

    const problems: string[] = [];
    if (branch !== "main") problems.push(`on branch ${branch}, not main`);
    if (porcelain.length > 0) problems.push("working tree dirty");

    const row: CheckRow = {
      id: "git",
      label: "git state",
      status: problems.length ? "stale" : "ok",
      detail: problems.length ? problems.join("; ") : `${count} commit(s) since ${tag}`,
    };
    return { row, tag, commitsSinceTag: count };
  } catch (err) {
    return {
      row: { id: "git", label: "git state", status: "error", detail: String((err as Error).message ?? err) },
      tag: null,
      commitsSinceTag: null,
    };
  }
}

export function checkPicker(seams: PreflightSeams): CheckRow {
  try {
    const v = seams.violations();
    if (v.length === 0) return { id: "picker", label: "picker:check", status: "ok", detail: "every required-positional leaf declares omitBehavior" };
    return { id: "picker", label: "picker:check", status: "stale", detail: `undeclared omitBehavior: ${v.map((x) => x.path).join(", ")}` };
  } catch (err) {
    return { id: "picker", label: "picker:check", status: "error", detail: String((err as Error).message ?? err) };
  }
}

const SCHEMA_LOCK = "packages/rt-client/src/settings/schema.lock.json";
const BREAKING_CHANGES = "packages/rt-client/src/settings/breaking-schema-changes.json";

/**
 * Reads the checkout's committed lock, never buildLock(): preflight runs from
 * the installed binary, whose bundled registry is not the checkout's. CI's
 * lock-in-sync step is what keeps the committed lock equal to the registry.
 */
export async function checkSchemaLock(seams: PreflightSeams, tag: string | null): Promise<CheckRow> {
  const id = "schema-lock";
  const label = "schema lock";
  try {
    if (!tag) throw new Error("no release tag to diff the lock against");
    const raw = seams.readFile(join(seams.repoRoot, SCHEMA_LOCK));
    if (!raw) throw new Error(`${SCHEMA_LOCK} not readable`);
    const committed = JSON.parse(raw) as Lock;
    const acknowledged = JSON.parse(seams.readFile(join(seams.repoRoot, BREAKING_CHANGES)) ?? "{}") as Record<string, string>;
    const shown = await seams.exec(["git", "show", `${tag}:${SCHEMA_LOCK}`], { cwd: seams.repoRoot });
    if (shown.exitCode !== 0) {
      if (isMissingPathAtRef(shown.stderr)) return { id, label, status: "ok", detail: `no lock at ${tag}` };
      throw new Error(`git show ${tag}:${SCHEMA_LOCK} failed: ${(shown.stderr || shown.stdout).trim() || `exit ${shown.exitCode}`}`);
    }
    let prev: Lock;
    try {
      prev = JSON.parse(shown.stdout) as Lock;
    } catch (err) {
      throw new Error(`${SCHEMA_LOCK} at ${tag} is not valid JSON: ${(err as Error).message}`);
    }
    const { ok, problems } = checkLockAgainst(prev, committed, acknowledged, { shipped: prev, mode: "release" });
    const bumps = Object.entries(committed)
      .filter(([k, e]) => prev[k] !== undefined && e.storeVersion > prev[k]!.storeVersion)
      .map(([k, e]) => `${k} ${prev[k]!.storeVersion} -> ${e.storeVersion}`);
    const notes = bumps.length > 0 ? `; storeVersion bumps for the release notes: ${bumps.join(", ")}` : "";
    return ok
      ? { id, label, status: "ok", detail: `no unmigrated breaking change since ${tag}${notes}` }
      : { id, label, status: "stale", detail: problems.join("; ") };
  } catch (err) {
    return { id, label, status: "error", detail: String((err as Error).message ?? err) };
  }
}

const FAILING_KINDS = new Set(["invalid", "nonconforming", "merged", "diverged"]);

/**
 * The candidate's own `rt settings check`, run from this checkout so its
 * registry and migrations are the ones being released, against the real
 * stores, read-only. A value the migrations cannot carry, or a diverged
 * older name, stops the release.
 */
export async function checkSettingsStores(seams: PreflightSeams): Promise<CheckRow> {
  const id = "settings-stores";
  const label = "settings stores";
  try {
    const r = await seams.exec(["bun", "run", "cli.ts", "settings", "check", "--json"], { cwd: seams.repoRoot, timeoutMs: 120_000 });
    const line = r.stdout.split("\n").find((l) => l.startsWith("{"));
    if (!line) throw new Error(`settings check printed no JSON (exit ${r.exitCode}): ${r.stderr.trim().slice(0, 200)}`);
    const report = JSON.parse(line) as { ok: boolean; findings: { key: string; kind: string; scope?: string; repo?: string; storeName?: string }[] };
    if (report.ok) return { id, label, status: "ok", detail: "every stored value passes after migration; no diverged names" };
    const detail = report.findings
      .filter((f) => FAILING_KINDS.has(f.kind))
      .map((f) => {
        const location = [f.scope, f.repo].filter(Boolean).join("/");
        return `${f.key} ${f.kind}${f.storeName ? ` (${f.storeName})` : ""}${location ? ` in ${location}` : ""}`;
      })
      .join("; ");
    return { id, label, status: "stale", detail };
  } catch (err) {
    return { id, label, status: "error", detail: String((err as Error).message ?? err) };
  }
}

/** The paths a pin-only release may touch besides the pins themselves. */
const FAST_PATH_FILES = new Set(["rt-tray/deps.lock", "RELEASE_NOTES.md"]);

/** Compared, never validated: any difference in what deck is told to run leaves the fast path. */
function serveKey(row: DepsRow | undefined): string {
  return JSON.stringify(row?.serve ?? null);
}

/**
 * `ref` other than HEAD reads that ref's committed deps.lock; HEAD reads the
 * working tree, which is what a release from this checkout would build.
 */
export async function checkGate(
  seams: Pick<PreflightSeams, "repoRoot" | "exec" | "readFile">,
  tag: string,
  ref = "HEAD",
): Promise<GateImplication> {
  try {
    const files = (await git(seams, ["diff", "--name-only", `${tag}..${ref}`])).split("\n").map((f) => f.trim()).filter(Boolean);
    if (files.length === 0) return { path: "full", reason: "no changes since the tag" };

    const outside = files.filter((f) => !FAST_PATH_FILES.has(f) && !f.startsWith("website/"));
    if (outside.length > 0) return { path: "full", reason: `changes outside the pin allowlist: ${outside.slice(0, 5).join(", ")}` };
    if (!files.includes("rt-tray/deps.lock")) return { path: "full", reason: "no deps.lock change to fast-path" };

    const oldRaw = await git(seams, ["show", `${tag}:rt-tray/deps.lock`]);
    const oldRows = new Map((JSON.parse(oldRaw) as { tools: DepsRow[] }).tools.map((r) => [r.name, r]));
    const rows = ref === "HEAD"
      ? readDepsRows(seams)
      : (JSON.parse(await git(seams, ["show", `${ref}:rt-tray/deps.lock`])) as { tools: DepsRow[] }).tools;
    const newNames = new Set(rows.map((r) => r.name));
    const removed = [...oldRows.keys()].filter((name) => !newNames.has(name));
    if (removed.length > 0) return { path: "full", reason: `row(s) removed from deps.lock: ${removed.join(", ")}` };
    const changed = rows.filter((r) => oldRows.get(r.name)?.version !== r.version).map((r) => r.name);
    // A row absent from the old lock, or one leaving pending, is a first-ever
    // ship of that app, which is beyond "pin-only" no matter how it is served.
    const added = changed.filter((name) => !oldRows.has(name));
    if (added.length > 0) return { path: "full", reason: `new row(s) in deps.lock: ${added.join(", ")}` };
    const restatused = rows.filter((r) => oldRows.has(r.name) && oldRows.get(r.name)!.status !== r.status).map((r) => r.name);
    if (restatused.length > 0) return { path: "full", reason: `status changed on row(s): ${restatused.join(", ")}` };
    const reserved = rows.filter((r) => oldRows.has(r.name) && serveKey(oldRows.get(r.name)) !== serveKey(r)).map((r) => r.name);
    if (reserved.length > 0) return { path: "full", reason: `serve changed on row(s): ${reserved.join(", ")}` };
    const gated = changed.filter((name) => !SERVE_ONLY_ROWS.has(name));
    if (gated.length > 0) return { path: "full", reason: `full-gate row(s) changed: ${gated.join(", ")}` };
    if (changed.length === 0) return { path: "full", reason: "deps.lock changed but no row version moved" };
    return { path: "fast", reason: `serve-only rows changed: ${changed.join(", ")}` };
  } catch (err) {
    return { path: "full", reason: `could not classify the diff (${String((err as Error).message ?? err)}); assume full` };
  }
}

export async function checkAppPins(seams: PreflightSeams, apps: DepsRow[]): Promise<CheckRow[]> {
  return Promise.all(
    apps.map(async (app): Promise<CheckRow> => {
      const id = `app:${app.name}`;
      const label = `app ${app.name}`;
      try {
        const tag = pinnedTagFromUrl(app.url);
        if (!tag) throw new Error("no release tag in the pinned url");
        const published = await ghApi(seams, `repos/${app.repo}/releases/tags/${tag}`, ".published_at");
        const lastCommit = await ghApi(seams, `repos/${app.repo}/commits?path=${app.subdir}&per_page=1`, ".[0].commit.committer.date");
        const publishedAt = new Date(published).getTime();
        const lastCommitAt = new Date(lastCommit).getTime();
        // jq prints the literal text "null" for a draft release's published_at
        // or an empty commit list; NaN would compare as fresh, the exact
        // silent pass this check exists to kill.
        if (Number.isNaN(publishedAt) || Number.isNaN(lastCommitAt)) {
          throw new Error(`unparseable dates (published ${published || "?"}, last commit ${lastCommit || "?"})`);
        }
        const stale = lastCommitAt > publishedAt;
        return {
          id, label,
          status: stale ? "stale" : "ok",
          pinned: app.version,
          detail: stale
            ? `pin published ${published.slice(0, 10)}, ${app.subdir} moved ${lastCommit.slice(0, 10)}`
            : `pin ${app.version} covers ${app.subdir} through ${lastCommit.slice(0, 10)}`,
        };
      } catch (err) {
        return { id, label, status: "error", pinned: app.version, detail: String((err as Error).message ?? err) };
      }
    }),
  );
}

export async function checkStandaloneRows(seams: PreflightSeams, rows: DepsRow[]): Promise<CheckRow[]> {
  return Promise.all(
    rows.map(async (row): Promise<CheckRow> => {
      const id = `standalone:${row.name}`;
      const label = `standalone ${row.name}`;
      try {
        const repo = row.repo ?? STANDALONE_REPOS[row.name]!;
        let latest: string;
        let source: string;
        try {
          latest = normalizeVersion(await ghApi(seams, `repos/${repo}/releases/latest`, ".tag_name"));
          source = "latest release";
        } catch (err) {
          // Only a 404 means "this repo publishes to npm and has no GitHub
          // releases" (fast-browser); then main's package.json is the currency
          // signal and also catches a merged-but-unpublished bump. Any other
          // failure must stay an error row, not silently switch signals.
          if (!/HTTP 404|Not Found/i.test(String((err as Error).message ?? err))) throw err;
          const b64 = await ghApi(seams, `repos/${repo}/contents/package.json`, ".content");
          latest = normalizeVersion((JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as { version: string }).version);
          source = "main package.json";
        }
        const pinned = normalizeVersion(row.version);
        return {
          id, label, pinned, current: latest,
          status: latest === pinned ? "ok" : "stale",
          detail: latest === pinned ? `pin ${pinned} matches ${repo}'s ${source}` : `pin ${pinned}, ${repo} ${source} is ${latest}`,
        };
      } catch (err) {
        return { id, label, status: "error", pinned: row.version, detail: String((err as Error).message ?? err) };
      }
    }),
  );
}

async function latestForUpstream(seams: PreflightSeams, up: ToolUpstream): Promise<string> {
  switch (up.kind) {
    case "github":
      return normalizeVersion(await ghApi(seams, `repos/${up.repo}/releases/latest`, ".tag_name"));
    case "node-lts": {
      const index = (await seams.fetchJson("https://nodejs.org/dist/index.json")) as { version: string; lts: unknown }[];
      const lts = index.find((e) => !!e.lts);
      if (!lts) throw new Error("no LTS entry in nodejs.org/dist/index.json");
      return normalizeVersion(lts.version);
    }
    case "npm": {
      const meta = (await seams.fetchJson(`https://registry.npmjs.org/${up.pkg}/latest`)) as { version: string };
      return normalizeVersion(meta.version);
    }
    case "gitlab": {
      const releases = (await seams.fetchJson(`https://gitlab.com/api/v4/projects/${up.project}/releases?per_page=1`)) as { tag_name: string }[];
      if (!releases[0]) throw new Error("no releases on the GitLab project");
      return normalizeVersion(releases[0].tag_name);
    }
  }
}

export async function checkToolRows(seams: PreflightSeams, rows: DepsRow[]): Promise<CheckRow[]> {
  // age/age-keygen and the sparkle pair share upstreams; resolve each once.
  const cache = new Map<string, Promise<string>>();
  const latest = (up: ToolUpstream): Promise<string> => {
    const key = JSON.stringify(up);
    let p = cache.get(key);
    if (!p) { p = latestForUpstream(seams, up); cache.set(key, p); }
    return p;
  };

  return Promise.all(
    rows.map(async (row): Promise<CheckRow> => {
      const id = `tool:${row.name}`;
      const label = `tool ${row.name}`;
      try {
        const up = upstreamForToolRow(row);
        if (!up) throw new Error(`no upstream derivable from ${row.url}`);
        const current = await latest(up);
        const pinned = normalizeVersion(row.version);
        const note = row.name.startsWith("sparkle") ? "; a sparkle bump gets its own tested release, never rides" : "";
        return {
          id, label, pinned, current,
          status: current === pinned ? "ok" : "stale",
          detail: current === pinned ? `pin ${pinned} is current` : `pin ${pinned}, upstream latest is ${current}${note}`,
        };
      } catch (err) {
        return { id, label, status: "error", pinned: row.version, detail: String((err as Error).message ?? err) };
      }
    }),
  );
}

interface CatalogPlugin {
  name: string;
  source: string | { source: string; url?: string; ref?: string; sha?: string };
}

export async function checkCatalog(seams: PreflightSeams): Promise<CheckRow[]> {
  const raw = seams.readFile(join(seams.repoRoot, "marketplace", "marketplace.json"));
  if (!raw) return [{ id: "catalog", label: "plugin catalog", status: "error", detail: "marketplace/marketplace.json not readable" }];
  let plugins: CatalogPlugin[];
  try {
    plugins = (JSON.parse(raw) as { plugins: CatalogPlugin[] }).plugins ?? [];
  } catch (err) {
    return [{ id: "catalog", label: "plugin catalog", status: "error", detail: `marketplace.json unparseable: ${String((err as Error).message ?? err)}` }];
  }

  return Promise.all(
    plugins.map(async (plugin): Promise<CheckRow> => {
      const id = `catalog:${plugin.name}`;
      const label = `catalog ${plugin.name}`;
      const src = plugin.source;
      if (typeof src === "string") return { id, label, status: "ok", detail: "in-tree plugin, nothing to drift" };
      if (!src || typeof src !== "object" || src.source !== "url" || !src.url) {
        return { id, label, status: "error", detail: "unsupported source shape" };
      }
      if (!src.ref) return { id, label, status: "ok", detail: "deliberate pin with no ref; --refresh never moves it" };
      try {
        const r = await seams.exec(["git", "ls-remote", src.url, src.ref], { timeoutMs: 30_000 });
        if (r.exitCode !== 0) throw new Error(`ls-remote failed: ${(r.stderr || r.stdout).trim()}`);
        const head = r.stdout.split(/\s+/)[0] ?? "";
        if (!head) throw new Error(`${src.ref} not found in ${src.url}`);
        const pinned = src.sha ?? "";
        return {
          id, label,
          pinned: pinned.slice(0, 12), current: head.slice(0, 12),
          status: head === pinned ? "ok" : "stale",
          detail: head === pinned ? `pin matches ${src.ref}` : `pin ${pinned.slice(0, 12)} behind ${src.ref} head ${head.slice(0, 12)}`,
        };
      } catch (err) {
        return { id, label, status: "error", detail: String((err as Error).message ?? err) };
      }
    }),
  );
}

export async function checkExtension(seams: PreflightSeams): Promise<CheckRow> {
  const id = "extension";
  const label = "chrome extension";
  try {
    const b64 = await ghApi(seams, `repos/${EXTENSION_LOCK_REPO}/contents/runtime-lock.json`, ".content");
    const lock = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as {
      runtime?: { url?: string };
      extension?: { version?: string };
    };
    const pinnedTag = pinnedTagFromUrl(lock.runtime?.url ?? "");
    if (!pinnedTag) throw new Error("runtime-lock.json has no fork release url");
    const releasesRaw = await ghApi(seams, `repos/${EXTENSION_FORK_REPO}/releases?per_page=30`);
    const tags = (JSON.parse(releasesRaw) as { tag_name: string }[]).map((r) => r.tag_name);
    const newest = tags
      .filter((t) => t.startsWith(EXTENSION_TAG_PREFIX))
      .sort((a, b) => compareVersions(normalizeVersion(b), normalizeVersion(a)))[0];
    if (!newest) throw new Error(`no ${EXTENSION_TAG_PREFIX}* releases on ${EXTENSION_FORK_REPO}`);
    const pinned = normalizeVersion(pinnedTag);
    const current = normalizeVersion(newest);
    const published = lock.extension?.version ? ` (store version ${lock.extension.version})` : "";
    return {
      id, label, pinned, current,
      status: current === pinned ? "ok" : "stale",
      detail: current === pinned
        ? `runtime-lock pins the newest fork release ${pinnedTag}${published}`
        : `runtime-lock pins ${pinnedTag}, fork newest is ${newest}; needs pin-runtime + a Web Store submit`,
    };
  } catch (err) {
    return { id, label, status: "error", detail: String((err as Error).message ?? err) };
  }
}

export async function checkRtClient(seams: PreflightSeams): Promise<CheckRow> {
  const id = "rt-client";
  const label = "rt-client parity";
  try {
    const raw = seams.readFile(join(seams.repoRoot, "packages", "rt-client", "package.json"));
    if (!raw) throw new Error("packages/rt-client/package.json not readable");
    const source = (JSON.parse(raw) as { version: string }).version;
    const npm = ((await seams.fetchJson("https://registry.npmjs.org/@mattstack/rt-client/latest")) as { version: string }).version;
    if (source === npm) return { id, label, status: "ok", pinned: npm, current: source, detail: `npm and source agree at ${source}` };
    const which = compareVersions(source, npm) > 0 ? `unpublished source bump (source ${source}, npm ${npm})` : `npm ahead of source (npm ${npm}, source ${source})`;
    return { id, label, status: "stale", pinned: npm, current: source, detail: which };
  } catch (err) {
    return { id, label, status: "error", detail: String((err as Error).message ?? err) };
  }
}

export async function runPreflight(seams: PreflightSeams): Promise<PreflightReport> {
  const gitState = await checkGitState(seams);

  let apps: DepsRow[] = [];
  let standalone: DepsRow[] = [];
  let tools: DepsRow[] = [];
  let lockError: CheckRow | null = null;
  try {
    ({ apps, standalone, tools } = classifyRows(readDepsRows(seams)));
  } catch (err) {
    lockError = { id: "deps-lock", label: "deps.lock", status: "error", detail: String((err as Error).message ?? err) };
  }

  const [gate, schemaLockRow, settingsStoresRow, appRows, standaloneRows, toolRows, catalogRows, extensionRow, rtClientRow] = await Promise.all([
    gitState.tag ? checkGate(seams, gitState.tag) : Promise.resolve(null),
    checkSchemaLock(seams, gitState.tag),
    checkSettingsStores(seams),
    checkAppPins(seams, apps),
    checkStandaloneRows(seams, standalone),
    checkToolRows(seams, tools),
    checkCatalog(seams),
    checkExtension(seams),
    checkRtClient(seams),
  ]);

  const rows: CheckRow[] = [
    gitState.row,
    checkPicker(seams),
    schemaLockRow,
    settingsStoresRow,
    ...(lockError ? [lockError] : []),
    ...appRows,
    ...standaloneRows,
    ...toolRows,
    ...catalogRows,
    extensionRow,
    rtClientRow,
  ];

  const staleCount = rows.filter((r) => r.status === "stale").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  return {
    tag: gitState.tag,
    commitsSinceTag: gitState.commitsSinceTag,
    gate,
    rows,
    staleCount,
    errorCount,
    clean: staleCount === 0 && errorCount === 0,
  };
}
