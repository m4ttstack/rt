import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';
import type { AgentLaunchResult } from '../agent-launch.ts';
import { mrTabLabel, type SkillPathResolver } from '../herdr.ts';
import { resolveSkillPath } from '../skill-path.ts';
import { GATE_LIST_PAGE_LIMIT, type GateEventFrame } from './ingest.ts';
import type { GateQuestion, GateState } from './store.ts';
import { domainForKind, GATE_KINDS, type GateDomain } from './sweep.ts';

/** The fields any domain's lifecycle state carries in common -- the subset
    a resume needs, regardless of which wrapper (review/respond/doctor)
    owns the file. ReviewState/RespondState/DoctorState each satisfy this
    once gateId/gateKind/resumedGateId are on them. */
export interface ResumableState {
  mrUrl: string;
  iid: number;
  status: string;
  agentId?: string;
  tabId?: string;
  paneId?: string;
  workspaceId?: string;
  gateId?: string;
  resumedGateId?: string;
}

/** Everything one resumable gate kind needs to rebuild its wrapper's
    re-entry prompt and persist a resumed pane's ids back onto its own state
    file. One record per kind (`review-post`, `respond-plan`, `respond-post`,
    `doctor-escalation`) -- server.ts wires review's record to today's
    plumbing unchanged and gives respond/doctor their own state fns and
    workspace. A kind with no record here has no board resume wiring at all
    (see `ResumeParkedGateIo.resumers`). */
export interface KindResumeIo {
  readState(mrUrl: string): ResumableState | undefined;
  writeState(
    path: string,
    patch: Partial<ResumableState> & { status: string }
  ): void;
  filePath(mrUrl: string): string;
  /** Resolve the domain skill the resumed wrapper should delegate to --
      review honors a tab's `reviewSkill` override via `tabId`; respond/doctor
      have no such override and ignore it. */
  resolveSkill(mrUrl: string, tabId?: string): string;
  /** Builds the wrapper's `--resumed-gate` re-entry prompt for this kind --
      each domain's own `dispatchPrompt("board:<domain>", {...}, resolvePath)`
      call, since the SkillPromptOpts fields a domain needs (e.g. review's
      `reportPath`) differ. */
  prompt(
    mrUrl: string,
    statePath: string,
    skill: string,
    resumedGate: string,
    resumedGateKind: string,
    resolvePath: SkillPathResolver
  ): Promise<string>;
  /** The status this kind's state settles into once its pane resumes.
      Review has exactly one in-flight status ("reviewing"), reproduced
      verbatim; respond/doctor each have a richer lifecycle and pick their
      own settle point rather than have one inferred generically. */
  resumedStatus: string;
  workspaceLabel: string;
}

/** Seams the real parked-gate resume needs beyond one kind's own IO: which
    kind maps to which KindResumeIo, launching into the resumed workspace,
    and the courtesy notify when a resume can't proceed. */
export interface ResumeParkedGateIo {
  resumers: Partial<Record<string, KindResumeIo>>;
  resumeAgentPane(opts: {
    agentId: string;
    prompt: string;
    workspaceLabel: string;
    tabLabel: string;
  }): Promise<AgentLaunchResult>;
  notify(message: string): void;
}

/** Builds the `resumers` map server.ts's gateResumeIo hands to
    ResumeParkedGateIo, one entry per GATE_KINDS member rather than a
    hand-maintained object literal -- a kind added to GATE_KINDS with no
    matching entry here comes out `undefined` instead of just missing from
    a literal, which is what lets the wiring test in
    gates-resume.test.ts catch a dropped kind instead of the whole suite
    passing silently. */
export function buildResumers(
  byDomain: Record<GateDomain, KindResumeIo>
): Partial<Record<string, KindResumeIo>> {
  const resumers: Partial<Record<string, KindResumeIo>> = {};
  for (const kind of GATE_KINDS) {
    const domain = domainForKind(kind);
    resumers[kind] = domain ? byDomain[domain] : undefined;
  }
  return resumers;
}

/**
 * The real parked-gate resume: rebuild the resumed kind's wrapper prompt
 * with `--resumed-gate <gateId>` (the flag the wrapper's re-entry rule keys
 * on to skip `gate open` and re-enter the domain skill directly) and resume
 * the pane the gate parked on, persisting the fresh pane ids to that kind's
 * own state file.
 *
 * A parked gate always carries the agentId it parked with -- ingest.ts sets
 * status: "parked" only on a gate that already opened a wrapper pane. A
 * missing agentId means that invariant broke (or the state file was hand
 * edited), so this degrades to a notify rather than throwing: the answer
 * itself already succeeded and must not be undone by a resume failure.
 *
 * Returns whether a pane actually resumed (`resumeAgentPane` returned) --
 * false on the missing-agentId notify branch, the unknown-kind skip, AND on
 * a failed dispatch, so none of those write the exactly-once marker and all
 * stay retryable (the next answered event or boot pass tries again). A
 * failure AFTER the dispatch (persisting the fresh pane ids) still returns
 * true: the pane exists, and a retry would launch a duplicate.
 */
export async function resumeParkedGate(
  gate: GateState,
  io: ResumeParkedGateIo,
  resolvePath: SkillPathResolver = resolveSkillPath
): Promise<boolean> {
  if (!gate.agentId) {
    io.notify(
      'parked gate answered but no agent on file; relaunch from the board'
    );
    return false;
  }

  const kindIo = Object.hasOwn(io.resumers, gate.kind)
    ? io.resumers[gate.kind]
    : undefined;
  if (!kindIo) {
    if ((GATE_KINDS as readonly string[]).includes(gate.kind))
      throw new Error(`${gate.kind} resume not wired`);
    console.error(
      `gate resume: unknown gate kind "${gate.kind}" on ${gate.mrUrl}; skipping`
    );
    return false;
  }

  const statePath = kindIo.filePath(gate.mrUrl);
  const skill = kindIo.resolveSkill(gate.mrUrl, gate.tabId);
  const prompt = await kindIo.prompt(
    gate.mrUrl,
    statePath,
    skill,
    gate.gateId,
    gate.kind,
    resolvePath
  );

  let result;
  try {
    result = await io.resumeAgentPane({
      agentId: gate.agentId,
      prompt,
      workspaceLabel: kindIo.workspaceLabel,
      tabLabel: mrTabLabel(gate.iid, undefined, '↺'),
    });
  } catch (err) {
    console.error(
      `parked gate resume failed: ${err instanceof Error ? err.message : err}`
    );
    return false;
  }
  if (result.focusedExisting) return true;
  try {
    kindIo.writeState(statePath, {
      status: kindIo.resumedStatus,
      agentId: result.agentId,
      paneId: result.paneId,
      tabId: result.tabId,
      workspaceId: result.workspaceId,
    });
  } catch (err) {
    console.error(
      `parked gate resume: pane ids not persisted: ${err instanceof Error ? err.message : err}`
    );
  }
  return true;
}

// ── Event-driven trigger: any surface's answer resumes the parked gate ────

type GateListPayload = {
  subjectPrefix: string;
  cursor?: number;
  limit?: number;
};
type GateListResult = {
  ok: boolean;
  data?: { gates: FacilityGateRow[]; cursor: number };
  error?: string;
};

/** Seams `handleAnsweredEvent`/`bootResumePass` need beyond `resumeParkedGate`'s
    own io: reading the (already cache-updated) facility rows and paging the
    facility's gate list for the boot pass. */
export interface GateResumeEventIo extends ResumeParkedGateIo {
  /** Every kind's cached row for one subject -- a subject can carry more
      than one live kind at once (a review-post gate alongside a respond or
      doctor one), so the caller matches by id, not by assuming a single
      row per subject. */
  rowsForSubject(subject: string): FacilityGateRow[];
  /** Writes a row fetched straight from the daemon into the board's cache
      (the cache-miss fallback in `handleAnsweredEvent`), so a later read of
      this subject doesn't have to refetch. */
  applyRow(row: FacilityGateRow): void;
  gateList(payload: GateListPayload): Promise<GateListResult>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * One answered-and-parked row, resumed by kind -- shared by the live event
 * path and the boot catch-up pass. Skips a row that was never parked (an
 * `open` gate answered directly never sets `parkedAt`, and it survives the
 * `answered` patch -- see GateCache.applyEvent) or one already resumed
 * (the `resumedGateId` dedup marker, tracked on that kind's own state file).
 * A KNOWN kind (in `GATE_KINDS`) with no `resumers` entry throws -- a resume
 * this board can't perform must never look like one that didn't need to
 * happen. An unknown kind (outside `GATE_KINDS` entirely) logs and skips
 * instead, since it was never this board's row to resume in the first
 * place. Re-reads state after the resume attempt so that write can't
 * clobber whatever status `resumeParkedGate` itself just settled on.
 */
async function resumeIfMissed(
  row: FacilityGateRow,
  io: GateResumeEventIo,
  resolvePath: SkillPathResolver
): Promise<void> {
  if (row.status !== 'answered' || row.parkedAt === null) return;
  if (!row.subject.startsWith('mr:')) return;
  const mrUrl = row.subject.slice('mr:'.length);

  const kindIo = Object.hasOwn(io.resumers, row.kind)
    ? io.resumers[row.kind]
    : undefined;
  if (!kindIo) {
    if ((GATE_KINDS as readonly string[]).includes(row.kind))
      throw new Error(`${row.kind} resume not wired`);
    console.error(
      `gate resume: unknown gate kind "${row.kind}" on ${row.subject}; skipping`
    );
    return;
  }

  const state = kindIo.readState(mrUrl);
  if (!state || state.resumedGateId === row.id) return;
  // A row that isn't the gate this state currently tracks is history -- a
  // fresh round superseded it and a new gate now owns this MR's answer flow.
  // Resuming it would re-post a stale answer into the current agent.
  if (state.gateId !== row.id) return;

  const gate: GateState = {
    gateId: row.id,
    mrUrl,
    iid: state.iid,
    kind: row.kind,
    status: 'answered',
    openedAt: row.openedAt,
    questions: row.questions as GateQuestion[],
    agentId: state.agentId,
    tabId: state.tabId,
  };
  const resumed = await resumeParkedGate(gate, io, resolvePath);
  if (!resumed) return;

  const fresh = kindIo.readState(mrUrl) ?? state;
  kindIo.writeState(kindIo.filePath(mrUrl), {
    status: fresh.status,
    resumedGateId: row.id,
  });
}

/** Pages `gateList({subjectPrefix})` to exhaustion looking for one gate id --
    the cache-miss fallback for `handleAnsweredEvent` and the shared paging
    shape `bootResumePass` also uses. `subjectPrefix` is a full `mr:<url>`
    subject here, not just `mr:`, so this only ever reads one MR's rows. */
async function fetchGateRowById(
  io: GateResumeEventIo,
  subjectPrefix: string,
  id: string
): Promise<FacilityGateRow | undefined> {
  let cursor: number | undefined;
  for (;;) {
    const res = await io.gateList({
      subjectPrefix,
      cursor,
      limit: GATE_LIST_PAGE_LIMIT,
    });
    if (!res.ok || !res.data) return undefined;
    const match = res.data.gates.find(row => row.id === id);
    if (match) return match;
    if (
      res.data.gates.length < GATE_LIST_PAGE_LIMIT ||
      res.data.cursor === cursor
    )
      return undefined;
    cursor = res.data.cursor;
  }
}

/**
 * Live path: fed one `gate/**` bus frame after the cache has already applied
 * it (server.ts's relay handler). Only a `gate/answered/<id>` frame for an
 * `mr:` subject can trigger a resume; anything else is a silent no-op so
 * this can sit directly in the relay callback without its own topic filter.
 */
export async function handleAnsweredEvent(
  frame: GateEventFrame,
  io: GateResumeEventIo,
  resolvePath: SkillPathResolver = resolveSkillPath
): Promise<void> {
  if (!frame.topic.startsWith('gate/answered/')) return;
  if (!isRecord(frame.payload)) return;
  const { id, subject } = frame.payload;
  if (typeof id !== 'string' || !id) return;
  if (typeof subject !== 'string' || !subject.startsWith('mr:')) return;

  let row = io.rowsForSubject(subject).find(r => r.id === id);
  if (!row) {
    // The cache doesn't have this gate (opened before the board last
    // started) or none of the subject's cached kinds match this id (stale)
    // -- ask the daemon directly rather than stranding the resume on a cold
    // cache.
    row = await fetchGateRowById(io, subject, id);
    if (!row) return;
    io.applyRow(row);
  }
  await resumeIfMissed(row, io, resolvePath);
}

/**
 * Boot catch-up: pages `gateList({subjectPrefix: "mr:"})` to exhaustion
 * (mirrors reconcileGatesOnBoot's paging in ingest.ts) and resumes any
 * answered-parked gate the board missed the live event for while it was
 * down. Independent of the gate cache -- reads the facility directly, so
 * it needs no ordering relative to the cache's own boot reconcile.
 */
export async function bootResumePass(
  io: GateResumeEventIo,
  resolvePath: SkillPathResolver = resolveSkillPath
): Promise<void> {
  let cursor: number | undefined;
  for (;;) {
    const res = await io.gateList({
      subjectPrefix: 'mr:',
      cursor,
      limit: GATE_LIST_PAGE_LIMIT,
    });
    if (!res.ok || !res.data) {
      console.error(
        `gate boot resume pass: gate:list failed: ${res.error ?? 'unknown error'}`
      );
      break;
    }
    for (const row of res.data.gates) {
      // One row this board can't resume (an unwired-kind throw) must not
      // stop the rest of the page -- or the rest of the pass.
      try {
        await resumeIfMissed(row, io, resolvePath);
      } catch (err) {
        console.error(
          `gate boot resume pass: resumeIfMissed(${row.id}) failed: ${err instanceof Error ? err.message : err}`
        );
      }
    }
    if (
      res.data.gates.length < GATE_LIST_PAGE_LIMIT ||
      res.data.cursor === cursor
    )
      break;
    cursor = res.data.cursor;
  }
}
