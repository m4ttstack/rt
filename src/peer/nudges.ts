import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import type { NudgeResult } from "./envelope.ts";

/** An inbound re-review request, materialized from a peer's envelope. */
export interface NudgeState {
  id: string;
  mrUrl: string;
  iid: number;
  from: string;
  note?: string;
  receivedAt: number;
  handled?: { at: number; result: NudgeResult; reason?: string };
}

/** One file per inbound nudge id -- lives here. */
export const NUDGE_DIR = join(import.meta.dir, "..", "..", "state", "nudges");

/** Deterministic file path for a nudge id. */
export function nudgeFilePath(id: string, dir: string = NUDGE_DIR): string {
  const slug = id.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200);
  return join(dir, `${slug}.json`);
}

/** Write an inbound nudge, atomically. No-op if a file for this id already
    exists -- at-least-once delivery from the switchboard means the same
    nudge can arrive more than once, and the first arrival wins. */
export function writeNudge(n: NudgeState, dir: string = NUDGE_DIR): void {
  const path = nudgeFilePath(n.id, dir);
  if (existsSync(path)) return;
  mkdirSync(dir, { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(n, null, 2) + "\n");
  renameSync(tmp, path);
}

/** Read all inbound nudges. */
export function readNudges(dir: string = NUDGE_DIR): NudgeState[] {
  const out: NudgeState[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const n = JSON.parse(readFileSync(join(dir, name), "utf8")) as NudgeState;
      if (n.id) out.push(n);
    } catch {
      continue;
    }
  }
  return out;
}

/** Read-merge-write a nudge's handled outcome, atomically. */
export function markNudgeHandled(
  id: string,
  result: NudgeResult,
  reason?: string,
  dir: string = NUDGE_DIR,
  now: number = Date.now(),
): void {
  const path = nudgeFilePath(id, dir);
  let prev: NudgeState;
  try {
    prev = JSON.parse(readFileSync(path, "utf8")) as NudgeState;
  } catch {
    return;
  }
  const next: NudgeState = { ...prev, handled: { at: now, result, reason } };
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, path);
}

/** Delete inbound nudges whose MR is no longer on the board. `keepUrls` is
    the current board MR set; callers gate this on a healthy snapshot so a
    failed fetch can't wipe live state. */
export function pruneNudges(keepUrls: ReadonlySet<string>, dir: string = NUDGE_DIR): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let mrUrl: string | undefined;
    try {
      mrUrl = (JSON.parse(readFileSync(path, "utf8")) as NudgeState).mrUrl;
    } catch {
      continue;
    }
    if (mrUrl && !keepUrls.has(mrUrl)) {
      rmSync(path, { force: true });
    }
  }
}

/** A nudge this board sent out, and how the recipient board eventually
    resolved it. */
export interface SentNudge {
  nudgeId: string;
  mrUrl: string;
  iid: number;
  reviewer: string;
  sentAt: number;
  resolution?: { result: NudgeResult | "confirmed"; reason?: string; at: number };
}

/** One file per mrUrl -- a board only ever has one outstanding sent nudge per MR. */
export const NUDGE_SENT_DIR = join(import.meta.dir, "..", "..", "state", "nudges-sent");

/** Deterministic file path for an mrUrl. */
export function sentNudgeFilePath(mrUrl: string, dir: string = NUDGE_SENT_DIR): string {
  const slug = mrUrl.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200);
  return join(dir, `${slug}.json`);
}

/** Write a sent nudge, atomically. */
export function writeSentNudge(n: SentNudge, dir: string = NUDGE_SENT_DIR): void {
  mkdirSync(dir, { recursive: true });
  const path = sentNudgeFilePath(n.mrUrl, dir);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(n, null, 2) + "\n");
  renameSync(tmp, path);
}

/** Read all sent nudges, keyed by mrUrl. */
export function readSentNudges(dir: string = NUDGE_SENT_DIR): Map<string, SentNudge> {
  const out = new Map<string, SentNudge>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const n = JSON.parse(readFileSync(join(dir, name), "utf8")) as SentNudge;
      if (n.mrUrl) out.set(n.mrUrl, n);
    } catch {
      continue;
    }
  }
  return out;
}

/** Read-merge-write a sent nudge's resolution, atomically. Silently returns
    when no file exists for this MR -- an outcome for a nudge this board
    never sent (e.g. a stale/duplicate delivery). An existing terminal
    resolution ("launched" / "rejected" / "expired") is never overwritten;
    only a "confirmed" resolution may be replaced, since confirmation is a
    provisional ack, not the final word. */
export function resolveSentNudge(
  mrUrl: string,
  resolution: NonNullable<SentNudge["resolution"]>,
  dir: string = NUDGE_SENT_DIR,
): void {
  const path = sentNudgeFilePath(mrUrl, dir);
  let prev: SentNudge;
  try {
    prev = JSON.parse(readFileSync(path, "utf8")) as SentNudge;
  } catch {
    return;
  }
  if (prev.resolution && prev.resolution.result !== "confirmed") return;
  const next: SentNudge = { ...prev, resolution };
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, path);
}

/** Retire a sent nudge once the re-review it asked for has finished: delete
    the file so the chip clears and "request re-review" comes back on the menu.
    The `ifSentBefore` guard keeps the ask alive when the finishing report is
    older than the nudge -- at-least-once delivery means a peer's pre-nudge
    "done" can arrive after a fresh ask went out, and that redelivery must not
    retire it. */
export function retireSentNudge(mrUrl: string, ifSentBefore: number, dir: string = NUDGE_SENT_DIR): void {
  const path = sentNudgeFilePath(mrUrl, dir);
  let prev: SentNudge;
  try {
    prev = JSON.parse(readFileSync(path, "utf8")) as SentNudge;
  } catch {
    return;
  }
  if (prev.sentAt >= ifSentBefore) return;
  rmSync(path, { force: true });
}

/** Delete sent nudges whose MR is no longer on the board. */
export function pruneSentNudges(keepUrls: ReadonlySet<string>, dir: string = NUDGE_SENT_DIR): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let mrUrl: string | undefined;
    try {
      mrUrl = (JSON.parse(readFileSync(path, "utf8")) as SentNudge).mrUrl;
    } catch {
      continue;
    }
    if (mrUrl && !keepUrls.has(mrUrl)) {
      rmSync(path, { force: true });
    }
  }
}

/** A sent nudge stays visible for this long with no board-to-board response
    before the chip self-expires to "no-response" in the UI. */
export const NUDGE_NO_RESPONSE_MS = 48 * 60 * 60_000;

export type SentNudgeDisplay = "requested" | "confirmed" | "launched" | "rejected" | "expired" | "no-response";

/** How a sent nudge should render right now. Resolution wins outright;
    otherwise it's "requested" until NUDGE_NO_RESPONSE_MS elapses, then the
    chip self-expires to "no-response" without needing a write. */
export function sentNudgeDisplay(n: SentNudge, now: number): SentNudgeDisplay {
  if (n.resolution) return n.resolution.result;
  return now - n.sentAt > NUDGE_NO_RESPONSE_MS ? "no-response" : "requested";
}
