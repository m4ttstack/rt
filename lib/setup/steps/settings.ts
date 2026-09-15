/**
 * `settings.seed` — writes the handful of machine-scoped keys nothing else
 * seeds automatically: `mattstack.appPath` (from `ctx.appPath`, already
 * resolved through bundleRootFromExec/installedTrayAppPath by
 * createApplyContext — no path regex of our own here), and promotes a
 * staged repo root into `rt.repoRoots`.
 *
 * The repo root is the user's own choice, made through the `repos.root`
 * checklist row (`rt setup repo-root set`), not something this step detects
 * or creates. By step 8 the home repo exists, so a staged answer can safely
 * be written to the machine store; see `lib/setup/repo-root.ts`.
 *
 * Never seeds a key with an empty placeholder value: T16's High finding —
 * scaffolding `board.projects: []` broke a running mr-board by flipping its
 * store-ownership latch — is exactly the failure mode this step must not
 * repeat. Every write here carries a real, non-empty value or doesn't happen.
 */

import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { promoteStagedRepoRoot } from "../repo-root.ts";
import type { ApplyContext } from "../apply.ts";
import type { StepDef, StepOutcome } from "../apply.ts";
import { toFailedOutcome } from "./step-utils.ts";

/** The DMG mount or a Gatekeeper-translocated copy — a bundle running from either is a transient location `mattstack.appPath` must never point at, since the app can vanish out from under that path the moment the DMG is ejected. Also `commands/post-install.ts`'s own pre-apply refusal — same predicate, single source. */
export function isTransientAppRoot(root: string): boolean {
  return root.startsWith("/Volumes/") || root.includes("/AppTranslocation/");
}

async function settingsSeedRun(ctx: ApplyContext): Promise<StepOutcome> {
  const written: string[] = [];

  if (ctx.appPath !== null) {
    if (isTransientAppRoot(ctx.appPath)) {
      return {
        state: "failed",
        detail: `running from ${ctx.appPath} — drag mattstack.app to /Applications, then Retry`,
        remedy: "Move mattstack.app to /Applications and relaunch it",
      };
    }
    // Only when it actually changes — a same-valued write on every Retry is
    // noise (a "wrote to the local store" line every time) and a lie about
    // what this run actually did.
    if (getSetting<string>("mattstack.appPath").value !== ctx.appPath) {
      setSetting("mattstack.appPath", ctx.appPath, "machine");
      written.push("mattstack.appPath");
    }
  }

  if (promoteStagedRepoRoot(ctx.p)) written.push("rt.repoRoots");

  return { state: "done", detail: written.length > 0 ? `wrote: ${written.join(", ")}` : "nothing to seed" };
}

async function settingsSeedRunSafe(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await settingsSeedRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const settingsSeedStep: StepDef = {
  id: "settings.seed",
  title: "Seed your settings",
  kind: "rt",
  applies: () => true,
  run: settingsSeedRunSafe,
};
