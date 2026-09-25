/**
 * `deck.managed`: brings the pre-deck board row under its real name. Which
 * apps deck serves is deck's own decision, made by its boot sweep from the
 * bundle's catalog, so this step registers no app itself.
 *
 * board ran under mattstack.app's own bootstrap as "mrs" before deck existed.
 * `deck adopt mrs --as board --json` is idempotent (exit 0 covers "just
 * adopted" and "already adopted"), and the record is then repointed at the
 * bundled board binary through deck's `/api/v1/apps/board` PATCH. A machine
 * that never ran that bootstrap answers "unknown app", the fresh-install
 * norm, so the leg skips and the step still completes.
 *
 * The gate is `bundledToolPath`, not `resolveTool().chosen`: a PATH copy
 * would pass `.chosen` and hand deck a command outside its own bundle.
 */

import { join } from "path";
import { bundledToolPath } from "../../deps/resolve.ts";
import type { ApplyContext } from "../apply.ts";
import type { StepDef, StepOutcome } from "../apply.ts";
import { toFailedOutcome } from "./step-utils.ts";

interface DeckApiFile {
  port?: unknown;
}

/** Exported for `lib/setup/uninstall.ts`'s deck.managed-remove, which needs the same "is deck actually up" check before asking it to unmanage anything. */
export function readDeckApiPort(ctx: ApplyContext): number | null {
  const raw = ctx.p.readFile(join(ctx.p.home, ".mattstack", "deck", "api.json"));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as DeckApiFile;
    return typeof parsed.port === "number" ? parsed.port : null;
  } catch {
    return null;
  }
}

export async function deckIsHealthy(ctx: ApplyContext, port: number): Promise<boolean> {
  const res = await ctx.p.fetch(`http://127.0.0.1:${port}/healthz`);
  return res.status === 200;
}

/** deck's own frozen error vocabulary for `adopt` — matched as substrings since the real CLI wraps them in a sentence, not a bare code. */
const FROZEN_ADOPT_ERRORS = ["unknown app", "deck not running", "name taken"] as const;

function matchFrozenError(text: string): (typeof FROZEN_ADOPT_ERRORS)[number] | null {
  return FROZEN_ADOPT_ERRORS.find((needle) => text.includes(needle)) ?? null;
}

type AdoptResult = { kind: "adopted" } | { kind: "skip"; detail: string } | { kind: "failed"; outcome: StepOutcome };

async function adoptBoard(ctx: ApplyContext, deckBin: string): Promise<AdoptResult> {
  const result = await ctx.p.exec([deckBin, "adopt", "mrs", "--as", "board", "--json"]);
  if (result.code === 0) return { kind: "adopted" }; // adopted, or already adopted

  const frozen = matchFrozenError(`${result.stdout}\n${result.stderr}`);

  // "unknown app" means deck has never heard of a legacy "mrs" — true of
  // every fresh install, since none of them ran the pre-deck bootstrap.
  // There is nothing to adopt, not a failed adopt.
  if (frozen === "unknown app") return { kind: "skip", detail: "no legacy mrs to adopt" };

  if (frozen === "deck not running") {
    // A precondition, not a rejection of the adopt itself — deck answered
    // /healthz a moment ago and stopped between then and this exec.
    return { kind: "failed", outcome: { state: "failed", detail: "deck stopped responding before it could adopt board", remedy: "Start deck, then Retry" } };
  }
  return { kind: "failed", outcome: { state: "failed", detail: frozen ?? (result.stderr.trim() || result.stdout.trim() || `deck adopt exited ${result.code}`), remedy: "Retry" } };
}

/** Idempotent: repointing at the same command/workingDirectory a second time is just another PATCH deck accepts. Skips honestly, never pointing the record at a binary that doesn't exist, when board isn't bundled yet. */
async function repointBoard(ctx: ApplyContext, port: number): Promise<string> {
  const boardBin = bundledToolPath(ctx.p, "board");
  if (boardBin === null) return "repoint skipped (board not bundled yet)";

  const boardDir = join(ctx.p.home, ".mattstack", "board");
  ctx.p.mkdirp(boardDir);
  const body = JSON.stringify({ command: [boardBin], workingDirectory: boardDir });
  const res = await ctx.p.fetch(`http://127.0.0.1:${port}/api/v1/apps/board`, { method: "PATCH", headers: { "content-type": "application/json" }, body });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`deck answered ${res.status} repointing board's record`);
  }
  return "repointed";
}

async function deckManagedRun(ctx: ApplyContext): Promise<StepOutcome> {
  const deckBin = bundledToolPath(ctx.p, "deck");
  if (deckBin === null) return { state: "skipped", detail: "deck not bundled yet" };

  const port = readDeckApiPort(ctx);
  const healthy = port !== null && (await deckIsHealthy(ctx, port));
  if (!healthy) {
    // A fresh non-interactive install reaches here with the app absent:
    // services.register just skipped for the same reason, so nothing has
    // started deck yet — that is a sequencing fact, not a failure. Deck
    // down while the app IS running stays a hard stop.
    const tray = await ctx.p.tray("/version", { method: "GET" });
    if (tray.status === 0) {
      return { state: "skipped", detail: "deck is not running and mattstack.app is not there to start it — open the app, then Retry" };
    }
    return { state: "failed", detail: "deck is not answering its own /healthz — cannot adopt board safely", remedy: "Start deck, then Retry" };
  }

  const adopted = await adoptBoard(ctx, deckBin);
  if (adopted.kind === "failed") return adopted.outcome;
  if (adopted.kind === "skip") return { state: "done", detail: `deck ready; ${adopted.detail}` };
  return { state: "done", detail: `deck ready; board adopted from legacy mrs, ${await repointBoard(ctx, port)}` };
}

async function deckManagedRunSafe(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await deckManagedRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const deckManagedStep: StepDef = {
  id: "deck.managed",
  title: "Set up managed deck",
  kind: "rt",
  applies: () => true,
  run: deckManagedRunSafe,
};
