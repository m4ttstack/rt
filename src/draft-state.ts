import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { APP_ROOT } from "./app-root.ts";

/** An outbound MR note the doctor DRAFTED but may never post. Held drafts are
    the only path to GitLab notes, and only the board's approval click walks
    it -- the doctor tier has no posting capability at all (spec §6). */
export type DraftStatus = "held" | "posted" | "dismissed";

export interface DraftState {
  mrUrl: string;
  iid: number;
  /** What the note is (e.g. "inherited-note", "rebase-note"). One draft per
      (mrUrl, kind): a re-draft overwrites rather than piling up. */
  kind: string;
  body: string;
  status: DraftStatus;
  createdAt: number;
  updatedAt: number;
  postedNoteId?: number;
}

export const DRAFT_DIR = join(APP_ROOT, "state", "drafts");

export function draftFilePath(mrUrl: string, kind: string, dir: string = DRAFT_DIR): string {
  const slug = `${mrUrl}-${kind}`.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200);
  return join(dir, `${slug}.json`);
}

export function writeDraft(
  path: string,
  patch: Partial<DraftState> & { status: DraftStatus },
  now: number = Date.now(),
): DraftState {
  let prev: Partial<DraftState> = {};
  try {
    prev = JSON.parse(readFileSync(path, "utf8")) as DraftState;
  } catch {
    // no prior draft -- start fresh
  }
  const next: DraftState = {
    mrUrl: patch.mrUrl ?? prev.mrUrl ?? "",
    iid: patch.iid ?? prev.iid ?? 0,
    kind: patch.kind ?? prev.kind ?? "",
    body: patch.body ?? prev.body ?? "",
    status: patch.status,
    createdAt: prev.createdAt ?? now,
    updatedAt: now,
    postedNoteId: patch.postedNoteId ?? prev.postedNoteId,
  };
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, path);
  return next;
}

export function readDrafts(dir: string = DRAFT_DIR): DraftState[] {
  const out: DraftState[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const d = JSON.parse(readFileSync(join(dir, name), "utf8")) as DraftState;
      if (d.mrUrl && d.kind) out.push(d);
    } catch {
      continue;
    }
  }
  return out;
}

export function heldDraftsByMr(drafts: DraftState[]): Map<string, DraftState[]> {
  const out = new Map<string, DraftState[]>();
  for (const d of drafts) {
    if (d.status !== "held") continue;
    const list = out.get(d.mrUrl) ?? [];
    list.push(d);
    out.set(d.mrUrl, list);
  }
  return out;
}

/** Same lifecycle as pruneDoctorStates: a draft lives as long as its MR is on
    the board. A merged/closed MR moots its held notes; the audit log keeps
    the record of what was drafted. */
export function pruneDrafts(keepUrls: ReadonlySet<string>, dir: string = DRAFT_DIR): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let mrUrl: string | undefined;
    try {
      mrUrl = (JSON.parse(readFileSync(path, "utf8")) as DraftState).mrUrl;
    } catch {
      continue;
    }
    if (mrUrl && !keepUrls.has(mrUrl)) rmSync(path, { force: true });
  }
}

export function attachDrafts<T extends { webUrl?: string | null }>(
  mrs: T[],
  held: Map<string, DraftState[]>,
): Array<T & { drafts?: DraftState[] }> {
  return mrs.map((mr) => (mr.webUrl && held.has(mr.webUrl) ? { ...mr, drafts: held.get(mr.webUrl) } : mr));
}
