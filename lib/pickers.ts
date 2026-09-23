/**
 * Shared picker flows for repo + worktree selection.
 *
 * Used by cd.ts and code.ts to avoid duplicating the
 * repo → worktree two-step picker with "switch repo" escape hatch.
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { groupWorktrees } from "./worktree-groups.ts";
import { pickWorktreeFromRepo, getWorkspacePackages, repoOptions, repoFromOptionValue, missingRepoRefusal, pickerWorktrees, type KnownRepo } from "./repo.ts";
import { enrichBranches, formatBranchSegments, type EnrichedBranch } from "./enrich.ts";
import { repoLabel } from "./repo-label.ts";
import type { PickHandle } from "./ui/pick.ts";
import type { PickAction, PickRow, PickSegment } from "./ui/protocol.ts";

const SWITCH_REPO     = "__switch_repo__"     as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export async function getRemoteUrl(repoPath: string): Promise<string | undefined> {
  try {
    return execSync("git config --get remote.origin.url", {
      cwd: repoPath, encoding: "utf8", stdio: "pipe",
    }).trim();
  } catch {
    return undefined;
  }
}

function dirNameOf(path: string): string {
  return path.split("/").pop() || path;
}

/** Appends a right-pinned "(current)" marker, matching a worktree's own segments when present. */
function annotateCurrent(right: PickSegment[], isCurrent: boolean): PickSegment[] {
  if (!isCurrent) return right;
  const marker: PickSegment = { text: "(current)", tone: "faint" };
  return right.length > 0 ? [...right, { text: "  " }, marker] : [marker];
}

/**
 * Cheap `branch · dirName` row shown the instant the picker opens, before
 * enrichment resolves — same branch-leads/dirName-leads split as
 * formatBranchSegments, so enrichment doesn't reorder rows' leading text.
 */
function cheapWorktreeRow(wt: { path: string; branch: string }, currentPath: string, group?: string): PickRow {
  const dirName = dirNameOf(wt.path);
  const left: PickSegment[] = !wt.branch
    ? [{ text: dirName, bold: true, column: true }]
    : [
        { text: dirName, bold: true, column: true },
        { text: "  ", tone: "faint" },
        { text: wt.branch, tone: "dim" },
      ];
  return { value: wt.path, left, right: annotateCurrent([], wt.path === currentPath), ...(group ? { group } : {}) };
}

function enrichedWorktreeRow(eb: EnrichedBranch, currentPath: string, group?: string): PickRow {
  const { left, right, match } = formatBranchSegments(eb);
  return { value: eb.path, left, right: annotateCurrent(right, eb.path === currentPath), match, ...(group ? { group } : {}) };
}

function repoOptionsFromList(repos: KnownRepo[]) {
  return repoOptions(repos);
}

const RELOAD_ACTION: PickAction = { id: "reload", label: "refresh", key: "ctrl-r", scope: "global", event: true };

/**
 * Single-step repo picker, built on the filterableSelect wrapper. Exported
 * for cd.ts's own inline repo picker (the `--repo --worktree` combo), which
 * needs the same reload wiring without going through `pickFromAllRepos`'s
 * repo→worktree loop.
 */
export async function pickRepo(
  repos: KnownRepo[],
  opts?: { onReload?: () => KnownRepo[] | Promise<KnownRepo[]>; breadcrumb?: string[] },
): Promise<string | null> {
  const { filterableSelect, optionsToRows } = await import("./pick-wrappers.ts");

  let handle: PickHandle | undefined;
  return filterableSelect(
    { message: "Pick a repo", options: repoOptionsFromList(repos), ...(opts?.breadcrumb ? { breadcrumb: opts.breadcrumb } : {}) },
    {
      ...(opts?.onReload ? { actions: [RELOAD_ACTION] } : {}),
      onOpen: (h) => { handle = h; },
      onEvent: async (evt) => {
        if (evt.action !== RELOAD_ACTION.id || !opts?.onReload) return;
        const fresh = await opts.onReload();
        handle?.update({ rows: optionsToRows(repoOptionsFromList(fresh)) });
      },
    },
  );
}

// ─── Pickers ─────────────────────────────────────────────────────────────────

/**
 * Show a worktree picker with a "switch to a different repo" escape hatch.
 * Filters out the current worktree. Returns SWITCH_REPO if user picks that.
 */
export async function pickWorktreeWithSwitch(
  repo: KnownRepo,
  currentPath: string,
  opts?: { stderr?: boolean; breadcrumb?: string[] },
): Promise<string | typeof SWITCH_REPO> {
  const { filterableSelect, BackNavigation } = await import("./pick-wrappers.ts");

  if (repo.worktrees.length === 0) return SWITCH_REPO;

  let liveHandle: PickHandle | undefined;
  const { worktrees, groupOf } = groupWorktrees(repo.repoName, pickerWorktrees(repo));
  const options = worktrees.map((wt) => ({ value: wt.path, label: wt.branch || dirNameOf(wt.path) }));

  const resultPromise = filterableSelect(
    {
      message: `${repoLabel(repo.repoName)} worktrees`,
      options,
      backLabel: "Switch to a different repo",
      ...(opts?.stderr ? { stderr: true } : {}),
      ...(opts?.breadcrumb ? { breadcrumb: opts.breadcrumb, crumbSuffix: ` · ${repoLabel(repo.repoName)} worktrees` } : {}),
    },
    {
      rows: worktrees.map((wt) => cheapWorktreeRow(wt, currentPath, groupOf.get(wt.path))),
      onOpen: (h) => { liveHandle = h; },
    },
  );

  // The picker is already on screen with cheap dirName·branch rows by the
  // time this fetch/cache round trip starts, so it never blocks the open.
  // Silent mode keeps its fetch spinner from printing over the live frame.
  void (async () => {
    const remoteUrl = await getRemoteUrl(repo.worktrees[0]?.path || currentPath);
    const enriched = await enrichBranches(worktrees, remoteUrl, { silent: true });
    liveHandle?.update({ rows: enriched.map((eb) => enrichedWorktreeRow(eb, currentPath, groupOf.get(eb.path))) });
  })().catch(() => {
    // Best-effort enrichment; the cheap rows already on screen stand as-is.
  });

  try {
    const picked = await resultPromise;
    // Esc/Ctrl-C → null; exit cleanly rather than leaking null through the
    // string return type (callers do selectedPath.split(...) etc.).
    if (!picked) process.exit(0);
    return picked;
  } catch (err) {
    if (err instanceof BackNavigation) return SWITCH_REPO;
    throw err;
  }
}

/**
 * Two-step repo → worktree picker from all known repos.
 * Auto-selects when there's only one option at either step.
 */
export async function pickFromAllRepos(
  repos: KnownRepo[],
  opts?: {
    stderr?: boolean;
    errorMessage?: string;
    includePackages?: boolean;
    /** In-process ctrl-r reload: re-lists repos and pushes fresh rows without closing the picker. */
    onReload?: () => KnownRepo[] | Promise<KnownRepo[]>;
    breadcrumb?: string[];
  },
): Promise<string> {
  const writer = opts?.stderr ? console.error : console.log;

  if (repos.length === 0) {
    const msg = opts?.errorMessage || "no known repos found — run rt from inside a git repo first";
    writer(`\n  ${msg}\n`);
    process.exit(1);
  }

  /** Refusing before the picker loads keeps a lost-repo-only index off the picker path entirely. */
  const refuse = (repo: KnownRepo): never => {
    writer(`\n  ${missingRepoRefusal(repo)}\n`);
    process.exit(1);
  };
  if (repos.length === 1 && repos[0]!.missing) refuse(repos[0]!);

  const { BackNavigation } = await import("./pick-wrappers.ts");

  // Loop: back from worktree/package picker restarts at repo picker
  while (true) {
    let selectedRepo: KnownRepo;

    if (repos.length === 1) {
      selectedRepo = repos[0]!;
    } else {
      const picked = await pickRepo(repos, { onReload: opts?.onReload, breadcrumb: opts?.breadcrumb });
      if (!picked) process.exit(1);
      selectedRepo = repoFromOptionValue(repos, picked)!;
    }
    if (selectedRepo.missing) refuse(selectedRepo);

    // Resolve worktree path (or auto-select if only one)
    let worktreePath: string | null;
    if (selectedRepo.worktrees.length === 1) {
      worktreePath = selectedRepo.worktrees[0]!.path;
    } else {
      try {
        worktreePath = await pickWorktreeFromRepo(
          selectedRepo,
          `${repoLabel(selectedRepo.repoName)} worktrees`,
          {
            backLabel: repos.length > 1 ? "Switch repo" : undefined,
            ...(opts?.breadcrumb ? { breadcrumb: opts.breadcrumb, crumbSuffix: ` · ${repoLabel(selectedRepo.repoName)} worktrees` } : {}),
          },
        );
      } catch (err) {
        if (err instanceof BackNavigation) continue;
        throw err;
      }
      if (!worktreePath) process.exit(0);
    }

    // If caller wants package-level navigation and this is a monorepo, go one
    // level deeper instead of returning the worktree root directly.
    if (opts?.includePackages) {
      const packages = getWorkspacePackages(worktreePath);
      if (packages.length > 0) {
        try {
          return await pickPackageWithEscape(selectedRepo, worktreePath, repos, opts);
        } catch (err) {
          if (err instanceof BackNavigation) continue;
          throw err;
        }
      }
    }

    return worktreePath;
  }
}

/** Check if user chose to switch repos. */
export function isSwitchRepo(value: string): boolean {
  return value === SWITCH_REPO;
}

// ─── Monorepo package picker ─────────────────────────────────────────────────

const GLYPH_APP     = "\u{F06D5}"; // nf-md-web
const GLYPH_PACKAGE = "\u{F03D7}"; // nf-md-package-variant

function dropNestedPackages(packages: { name: string; path: string }[]): typeof packages {
  return packages.filter((p) =>
    !packages.some((other) => other !== p && p.path.startsWith(other.path + "/")),
  );
}

function packageGroup(path: string): string {
  const top = path.split("/")[0] ?? "";
  if (top === "apps") return "apps";
  if (top === "packages") return "packages";
  return top || "root";
}

function packageRow(
  value: string,
  label: string,
  hint: string,
  group: string,
): PickRow {
  const glyph = group === "apps" ? GLYPH_APP : GLYPH_PACKAGE;
  const tone = group === "apps" ? "cyan" : "lav";
  const left: PickSegment[] = [
    { text: glyph + " ", tone },
    { text: label, bold: true, column: true },
    { text: `  ${hint}`, tone: "dim" },
  ];
  return { value, match: label, left, group };
}

/**
 * Package picker for monorepos (pnpm workspace). Shows all packages in the
 * current worktree plus escape hatches to switch worktree or repo.
 *
 * Returns the absolute path of the selected destination (package dir,
 * worktree root, or a different worktree/repo root).
 */
export async function pickPackageWithEscape(
  repo: KnownRepo,
  worktreePath: string,
  allRepos: KnownRepo[],
  opts?: { stderr?: boolean; breadcrumb?: string[] },
): Promise<string> {
  const { filterableSelect, BackNavigation } = await import("./pick-wrappers.ts");

  let packages = dropNestedPackages(getWorkspacePackages(worktreePath));
  let currentBranch = repo.worktrees.find((wt) => wt.path === worktreePath)?.branch ?? "";
  const hasMultipleWorktrees = repo.worktrees.length > 1;

  // Loop: BackNavigation from the worktree picker returns here
  const hasMultipleRepos   = allRepos.length > 1;

  while (true) {
    let rootLabel = "(root)";
    try {
      const pkg = JSON.parse(readFileSync(join(worktreePath, "package.json"), "utf8"));
      if (pkg.name) rootLabel = pkg.name;
    } catch { /* no package.json or unreadable */ }

    const hasApps = packages.some((p) => packageGroup(p.path) === "apps");

    const rootRow: PickRow = {
      value: worktreePath,
      match: hasApps ? "(root)" : rootLabel,
      left: hasApps
        ? [
            { text: " ", tone: "blue" },
            { text: "(root)", bold: true, column: true },
            { text: `  ${currentBranch}`, tone: "dim" },
          ]
        : [
            { text: GLYPH_APP + " ", tone: "cyan" },
            { text: rootLabel, bold: true, column: true },
            { text: `  ${currentBranch}`, tone: "dim" },
          ],
    };

    const rows: PickRow[] = [
      rootRow,
      ...packages.map((p) => {
        const group = packageGroup(p.path);
        return packageRow(join(worktreePath, p.path), p.name, p.path, group);
      }),
    ];

    const backLabel = hasMultipleWorktrees
      ? "Switch worktree"
      : hasMultipleRepos
        ? "Switch repo"
        : undefined;

    try {
      const picked = await filterableSelect(
        {
          message: repoLabel(repo.repoName),
          options: [],
          backLabel,
          ...(opts?.stderr ? { stderr: true } : {}),
          ...(opts?.breadcrumb ? { breadcrumb: opts.breadcrumb, crumbSuffix: ` · ${repoLabel(repo.repoName)}` } : {}),
        },
        { rows },
      );

      if (!picked) process.exit(1);
      return picked;

    } catch (err) {
      if (err instanceof BackNavigation) {
        if (hasMultipleWorktrees) {
          // ctrl-up → "Switch worktree"
          if (hasMultipleRepos) {
            const wtResult = await pickWorktreeWithSwitch(repo, worktreePath, opts);
            if (!wtResult) process.exit(0); // esc
            if (isSwitchRepo(wtResult)) {
              return pickFromAllRepos(allRepos, { ...opts, includePackages: true });
            }
            worktreePath = wtResult;
          } else {
            const newPath = await pickWorktreeFromRepo(repo, `${repoLabel(repo.repoName)} worktrees`, {
              ...(opts?.breadcrumb ? { breadcrumb: opts.breadcrumb, crumbSuffix: ` · ${repoLabel(repo.repoName)} worktrees` } : {}),
            });
            if (!newPath) process.exit(0); // esc
            worktreePath = newPath;
          }
          // Re-enter the loop with the new worktree's packages
          packages = dropNestedPackages(getWorkspacePackages(worktreePath));
          currentBranch = repo.worktrees.find((wt) => wt.path === worktreePath)?.branch ?? "";
          continue;
        } else if (hasMultipleRepos) {
          // ctrl-up → "Switch repo" (no worktrees to switch between)
          return pickFromAllRepos(allRepos, { ...opts, includePackages: true });
        }
      }
      throw err;
    }
  }
}

// ─── Worktree branch resolver (--worktree flag) ───────────────────────────────

/**
 * Resolve a worktree by branch name prefix across the given repos.
 * - Exact or unambiguous prefix match → returns path directly (no picker)
 * - Multiple matches → shows a filtered picker
 * - No match → exits with a helpful message
 */
export async function resolveWorktreeByBranch(
  branch: string,
  repos: KnownRepo[],
  opts?: { stderr?: boolean; breadcrumb?: string[] },
): Promise<string> {
  const { filterableSelect } = await import("./pick-wrappers.ts");

  const lower = branch.toLowerCase();
  const matches: { path: string; branch: string; repoName: string }[] = [];

  for (const repo of repos) {
    for (const wt of repo.worktrees) {
      if (wt.branch.toLowerCase().startsWith(lower)) {
        matches.push({ path: wt.path, branch: wt.branch, repoName: repo.repoName });
      }
    }
  }

  if (matches.length === 0) {
    const writer = opts?.stderr ? process.stderr : process.stdout;
    writer.write(`\n  no worktree found matching branch: "${branch}"\n\n`);
    process.exit(1);
  }

  if (matches.length === 1) return matches[0]!.path;

  // Ambiguous — show a picker limited to the matching worktrees
  const picked = await filterableSelect({
    message: `Pick worktree ("${branch}"…)`,
    options: matches.map((m) => ({
      value: m.path,
      label: m.branch,
      hint: repos.length > 1 ? repoLabel(m.repoName) : m.path.replace(process.env.HOME ?? "", "~"),
    })),
    ...(opts?.stderr ? { stderr: true } : {}),
    ...(opts?.breadcrumb ? { breadcrumb: opts.breadcrumb } : {}),
  });

  if (!picked) process.exit(1);
  return picked;
}
