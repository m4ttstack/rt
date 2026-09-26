import type { GateAnswers, GateQuestion, GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';

/**
 * One gate per kind and variant the rt daemon has actually opened, rebuilt
 * as invented data: the question counts, option shapes and label lengths,
 * "(Recommended)" markers, multi flags, structured gate-ctx JSON, prose
 * contexts, pane screens and meta keep the real rows' structure, while
 * every name, ticket, MR, path and piece of domain wording is made up. This
 * repo is public, so nothing here may be copied from a live board.
 */

export interface GalleryGate {
  gate: GateRow;
  mr?: BoardMRWithReview;
}

export const PEOPLE: ReadonlyMap<string, string> = new Map([
  ['pat', 'Pat Lin'],
  ['renee', 'Renee Park'],
  ['alex', 'Alex Moreno'],
  ['jvasquez', 'Joel Vasquez'],
  ['dana', 'Dana Ortiz'],
]);

const minutesAgo = (m: number) => Date.now() - m * 60_000;
const ctx = (v: unknown) => JSON.stringify(v);

type Opt = { value: string; label: string; description?: string };

function opt(value: string, label: string, description?: string): Opt {
  return description === undefined
    ? { value, label }
    : { value, label, description };
}

function question(
  id: string,
  label: string,
  multi: boolean,
  options: GateQuestion['options'],
  context?: string
): GateQuestion {
  return { id, label, multi, options, ...(context ? { context } : {}) };
}

const FORGE = 'https://gitlab.example.com/acme/webapp/-/merge_requests';

interface MrStatus {
  pipeline: 'passed' | 'running' | 'failed' | 'none';
  approvals: [given: number, required: number];
  behind?: number;
  conflicts?: boolean;
  draft?: boolean;
}

function boardMr(
  iid: number,
  title: string,
  author: string,
  sourceBranch: string,
  diff: [number, number, number],
  status: MrStatus,
  targetBranch = 'main'
): BoardMRWithReview {
  const [given, required] = status.approvals;
  return {
    iid,
    title,
    webUrl: `${FORGE}/${iid}`,
    author: {
      id: `gitlab:${author.length + iid}`,
      username: author,
      name: PEOPLE.get(author) ?? author,
      avatarUrl: null,
    },
    sourceBranch,
    targetBranch,
    isDraft: status.draft ?? false,
    createdAt: new Date(minutesAgo(60 * 26)).toISOString(),
    diff: { additions: diff[0], deletions: diff[1], filesChanged: diff[2] },
    pipelineState: status.pipeline,
    behindTarget: status.behind ?? null,
    reviews: {
      required,
      given,
      remaining: Math.max(required - given, 0),
      isApproved: given >= required,
      approvedBy: [],
      reviewers: [],
      totalAssigned: 0,
      haveActed: given,
      havePending: 0,
      haveNotStarted: 0,
    },
    blockers: {
      isDraft: status.draft ?? false,
      hasConflicts: status.conflicts ?? false,
      needsRebase: false,
      pipelineFailing: status.pipeline === 'failed',
      pipelineRunning: status.pipeline === 'running',
      awaitingApprovals: given < required,
    },
  } as unknown as BoardMRWithReview;
}

const mrSubject = (iid: number) => `mr:${FORGE}/${iid}`;

const TREES = '/Users/pat/worktrees/gl-acme-webapp';

// --- MRs --------------------------------------------------------------------

export const MRS = {
  radarLayers: boardMr(
    812,
    'ACME-3391: skip late radar models once the map is torn down',
    'jvasquez',
    'acme-3391-late-radar-models',
    [96, 14, 3],
    { pipeline: 'passed', approvals: [0, 1] }
  ),
  flagTargeting: boardMr(
    774,
    'ACME-3342: send flag targeting attributes at both levels',
    'pat',
    'acme-3342-flag-targeting-both-levels',
    [58, 11, 5],
    { pipeline: 'running', approvals: [0, 1], behind: 12 }
  ),
  sensorCount: boardMr(
    739,
    'ACME-2690: sensors summary chip shows a count',
    'pat',
    'acme-2690-sensors-chip-count',
    [141, 37, 6],
    { pipeline: 'passed', approvals: [1, 2] }
  ),
  stationFold: boardMr(
    777,
    'ACME-3288: fold duplicate stations that share an owner',
    'pat',
    'acme-3288-fold-shared-owner-stations',
    [212, 48, 7],
    { pipeline: 'passed', approvals: [1, 1] }
  ),
  primaryContacts: boardMr(
    702,
    'ACME-3203: keep primary station contacts on merge',
    'pat',
    'acme-3203-primary-station-contacts',
    [330, 92, 9],
    { pipeline: 'failed', approvals: [0, 1], behind: 40 }
  ),
  scriptFrames: boardMr(
    751,
    'ACME-3355: drop tracker events from vendor script frames',
    'dana',
    'acme-3355-vendor-frames',
    [74, 9, 3],
    { pipeline: 'passed', approvals: [0, 1] }
  ),
  expiredLinks: boardMr(
    760,
    'ACME-3309: route expired magic-link tokens to the expired page',
    'dana',
    'acme-3309-expired-magic-links',
    [118, 26, 4],
    { pipeline: 'passed', approvals: [0, 1] }
  ),
  pictograms: boardMr(
    688,
    'ACME-3150: move the forecast pictograms into the asset package',
    'pat',
    'acme-3150-forecast-pictograms',
    [402, 388, 41],
    { pipeline: 'failed', approvals: [0, 1] },
    'panel-model-split'
  ),
  highlights: boardMr(
    715,
    'ACME-2530: highlights data correctness batch',
    'pat',
    'acme-2530-highlights-data-correctness',
    [527, 163, 22],
    { pipeline: 'running', approvals: [0, 1], behind: 284, conflicts: true }
  ),
  advisoryPlans: boardMr(
    713,
    'ACME-2538: source explicit-false advisory plans to their boolean',
    'pat',
    'acme-2538-advisory-plan-provenance',
    [89, 17, 4],
    { pipeline: 'passed', approvals: [0, 1] }
  ),
} as const;

// --- Respond ----------------------------------------------------------------

const FLAG_THREADS = {
  t1: 'b53402b5660b44a2f0853396a28400b4b7817e8d',
  t2: 'd22b9ade1b338f6ff780ad566e7f1296de0bbe4d',
  t3: '4af8e61b771b4f66c7bff062b79acabbed296b40',
  t4: 'c4f19dc1ab7c765fe664ec59c5535259177b4275',
  t5: 'cad019c3b2b89bc7e1bb5034fc92d34df3b7d152',
};

const FLAG_REPLIES = {
  t1: 'checked every client-side flag across all flag-service envs. 17 have `host` rules, each `is one of` specific preview urls in preview/qa/staging envs.\nno `region` rules, nothing negated, nothing in prod.\nso they only go live on the preview hosts they name, which i think is what they were written for.\nadded that to the description.',
  t3: 'switched both to spread `requireActual`. the spread drops `__esModule` though, so i set it back explicitly or `config` still resolves to the wrong object.',
};

const FLAG_FILES = {
  t1: 'apps/web/src/hooks/useFlagClient.tsx:56',
  t2: 'apps/web/src/hooks/useFlagClient.tsx:61',
  t3: 'apps/web/src/hooks/useFlagClient.test.ts:23',
  t4: 'MR-level note (ACME-4410, ACME-4411)',
  t5: 'MR-level note (re-review)',
};

const flagOrigin = {
  presentation: 'form' as const,
  surface: 'board',
  tabId: 'w22:t1',
  paneId: 'w22:p1',
  runId: '20260923-135111-7e4b-30258',
};

const planThread = (
  n: number,
  thread: string,
  label: string,
  recommended: 'reply' | 'fix',
  descriptions: { reply: string; fix: string; skip: string },
  context: string
) =>
  question(
    `thread-${n}`,
    label,
    false,
    [
      opt(
        `reply:${thread}`,
        recommended === 'reply' ? 'Reply (Recommended)' : 'Reply',
        descriptions.reply
      ),
      opt(
        `fix:${thread}`,
        recommended === 'fix' ? 'Fix (Recommended)' : 'Fix',
        descriptions.fix
      ),
      opt(`skip:${thread}`, 'Skip', descriptions.skip),
    ],
    context
  );

const REPLY_ONLY = 'reply only; no code change';
const NO_REPLY = 'no reply, no code change';

export const respondPlan: GalleryGate = {
  mr: MRS.flagTargeting,
  gate: {
    gateId: 'gallery-respond-plan',
    subject: mrSubject(774),
    kind: 'respond-plan',
    label: 'respond gate !774',
    status: 'open',
    openedAt: minutesAgo(9),
    meta: { label: 'respond gate !774' },
    domain: 'respond',
    origin: { ...flagOrigin, worktree: '/Users/pat/code/webapp' },
    context: ctx({
      'gate-ctx': 'plan@1',
      reviewer: 'renee',
      round: 1,
      threads: { total: 5, blocking: 2 },
      adjudication: 'all valid · fresh-context adjudicated',
    }),
    questions: [
      planThread(
        1,
        FLAG_THREADS.t1,
        FLAG_FILES.t1,
        'fix',
        {
          reply: REPLY_ONLY,
          fix: 'adds a flag-check line to the MR description (no code change)',
          skip: NO_REPLY,
        },
        ctx({
          'gate-ctx': 'thread@1',
          author: 'renee',
          severity: 'blocking',
          claim: {
            summary:
              'did you check which existing flag rules this turns on? add a line to the MR description listing the web-consumed flags with `host`/`region` rules and whether each should activate',
            points: [
              'every dormant `host`/`region` rule goes live at once on merge, prod included',
              'negated rules can flip: a dormant `region is not one of …` starts matching',
              'the ticket asked for this check',
            ],
          },
          verdict: {
            call: 'valid',
            note: 'ticket asked for it and the description lacks it. flag CLI scan: 17 client-side flags, 24 `host` rules, all positive `in` on preview urls in preview/qa/staging envs; no `region`, none negated, none in prod',
          },
          reply: { kind: 'direction', text: FLAG_REPLIES.t1 },
        })
      ),
      planThread(
        2,
        FLAG_THREADS.t2,
        FLAG_FILES.t2,
        'fix',
        {
          reply: REPLY_ONLY,
          fix: 'one-line comment above the top-level spread in `useFlagClient.tsx:56` and kiosk `useFlagClients.tsx:80`',
          skip: NO_REPLY,
        },
        ctx({
          'gate-ctx': 'thread@1',
          author: 'renee',
          severity: 'blocking',
          claim: {
            summary:
              'add a one-line comment here and at the kiosk pair (`useFlagClients.tsx:80,83`) saying why the attributes are sent twice',
            points: [
              "with `kind: 'user'` the SDK doesn't flatten `extra`, so top level serves plain `host` rules and `extra` serves `/extra/host`",
              "the ticket's suggested fix got this backwards, so a reader could tidy the duplicate the wrong way",
            ],
          },
          verdict: {
            call: 'valid',
            note: 'the point holds (flattening only when `kind` is absent). the flag service has 21 `host` and 3 `/extra/host` clauses, so both copies are live. non-obvious invariant, passes the comment bar',
          },
          reply: {
            kind: 'direction',
            text: 'added a one-liner above both spreads.',
          },
        })
      ),
      planThread(
        3,
        FLAG_THREADS.t3,
        FLAG_FILES.t3,
        'fix',
        {
          reply: REPLY_ONLY,
          fix: 'both config mocks spread `requireActual` plus `__esModule: true` (`useFlagClient.test.ts:23`, kiosk `useFlagClients.test.tsx:7`)',
          skip: NO_REPLY,
        },
        ctx({
          'gate-ctx': 'thread@1',
          author: 'renee',
          severity: 'non-blocking',
          claim: {
            summary:
              'the config mocks replace the whole module with only `appConfig`; spread `jest.requireActual` and override just `appConfig.flagHost`',
            points: [
              'same in kiosk `useFlagClients.test.tsx:7`',
              'nothing reads `config` at load today, but a later reader would fail confusingly',
            ],
          },
          verdict: {
            call: 'valid',
            note: 'minor. under esModuleInterop `config` is `{ appConfig }` rather than undefined, same effect. a bare spread drops `__esModule`, so the fix sets it back',
          },
          reply: { kind: 'direction', text: FLAG_REPLIES.t3 },
        })
      ),
      planThread(
        4,
        FLAG_THREADS.t4,
        FLAG_FILES.t4,
        'fix',
        {
          reply: REPLY_ONLY,
          fix: "links ACME-4410/ACME-4411 from the description's out-of-scope bullets (no code change)",
          skip: NO_REPLY,
        },
        ctx({
          'gate-ctx': 'thread@1',
          author: 'renee',
          severity: 'none',
          claim: {
            summary:
              'FYI: filed ACME-4410 (client contexts nest targeting attrs under `extra`) and ACME-4411 (client `region` is the auth provider attribute) as out-of-scope follow-ups',
          },
          verdict: {
            call: 'valid',
            note: 'both notes check out; no change asked in this MR. linking both from the description gives them a home',
          },
          reply: {
            kind: 'direction',
            text: '👍 linked both from the description.',
          },
        })
      ),
      planThread(
        5,
        FLAG_THREADS.t5,
        FLAG_FILES.t5,
        'reply',
        {
          reply: REPLY_ONLY,
          fix: "implement the reviewer's ask as written",
          skip: NO_REPLY,
        },
        ctx({
          'gate-ctx': 'thread@1',
          author: 'renee',
          severity: 'none',
          claim: {
            summary:
              'let me know when this is ready for re-review; reply or resolve this thread',
          },
          verdict: {
            call: 'valid',
            note: 'process only; reply once threads 1-4 are addressed',
          },
          reply: { kind: 'verbatim', text: 'Ready for another look!' },
        })
      ),
      question('code-changes', 'Approve the proposed code changes?', false, [
        opt('approve', 'Approve'),
        opt('revise', 'Revise'),
        opt('skip', 'Skip'),
      ]),
    ],
  },
};

const SENSOR_THREADS = {
  t1: '89057e2a50cbaab9770cdc541b8b287286fac782',
  t2: 'e71863d567003666f3bb6427cdd809423883b14d',
};

const SENSOR_FIX_REPLY =
  'fixed. $tallyFilteredSensors now sources off sensor.$summary ... matches $tallyStationRelays. also fixed the jsdoc and dropped the assertions pinning the old provenance.';
const SENSOR_REREVIEW_REPLY =
  'addressed the count-provenance finding on $tallyFilteredSensors. ready for re-review';

const codeChangesRecommended = question(
  'code-changes',
  'Approve the proposed code changes?',
  false,
  [
    opt('approve', 'Approve (Recommended)'),
    opt('revise', 'Revise'),
    opt('skip', 'Skip'),
  ]
);

export const respondPlanTwoThreads: GalleryGate = {
  mr: MRS.sensorCount,
  gate: {
    gateId: 'gallery-respond-plan-two',
    subject: mrSubject(739),
    kind: 'respond-plan',
    label: 'respond gate !739',
    status: 'open',
    openedAt: minutesAgo(31),
    meta: { label: 'respond gate !739' },
    domain: 'respond',
    origin: { presentation: 'form', surface: 'board', paneId: 'w12:p1' },
    context: ctx({
      'gate-ctx': 'plan@1',
      reviewer: 'renee',
      round: 1,
      threads: { total: 2, blocking: 1 },
      adjudication: 'both valid · fresh-context adjudicated',
    }),
    questions: [
      planThread(
        1,
        SENSOR_THREADS.t1,
        'readers.ts:796',
        'fix',
        {
          reply: 'post the drafted reply as-is; no code change',
          fix: 'source off sensor.$summary (mirrors $tallyStationRelays), fix the JSDoc at :787-790, update the 2 tests pinning the old provenance',
          skip: NO_REPLY,
        },
        ctx({
          'gate-ctx': 'thread@1',
          author: 'renee',
          severity: 'blocking',
          claim: {
            summary:
              "$tallyFilteredSensors derives the count's source badge from every leaf on each sensor row, but only description + row-existence decide the count.",
            points: [
              "a non-decider like $alias / $serialNumber moves the badge without the number changing -- test :151 renders '2 sensors · RADAR' where RADAR is on no displayed sensor",
              'violates the pickLatestSource ACME-2560 JSDoc and panel-code-review item 2 (ALWAYS BLOCKING)',
              'lone outlier vs 5 sibling $tally* readers',
            ],
          },
          verdict: {
            call: 'valid',
            note: 'every sub-point confirmed against the checkout (fresh context, opus)',
          },
          reply: { kind: 'verbatim', text: SENSOR_FIX_REPLY },
        })
      ),
      planThread(
        2,
        SENSOR_THREADS.t2,
        're-review (general thread)',
        'reply',
        {
          reply: 'post the drafted reply once the fix lands',
          fix: 'treat it as a change request and land code first',
          skip: NO_REPLY,
        },
        ctx({
          'gate-ctx': 'thread@1',
          author: 'renee',
          severity: 'none',
          claim: {
            summary:
              "'Let me know when this is ready for re-review. Please reply or resolve this thread.'",
          },
          verdict: {
            call: 'valid',
            note: 'procedural, not a code ask -- reply once the fix lands',
          },
          reply: { kind: 'verbatim', text: SENSOR_REREVIEW_REPLY },
        })
      ),
      codeChangesRecommended,
    ],
  },
};

const proseThread = (
  n: number,
  thread: string,
  label: string,
  recommended: 'reply' | 'fix',
  context: string
) =>
  question(
    `thread-${n}`,
    label,
    false,
    [
      opt(
        `reply:${thread}`,
        recommended === 'reply' ? 'Reply (Recommended)' : 'Reply'
      ),
      opt(`fix:${thread}`, recommended === 'fix' ? 'Fix (Recommended)' : 'Fix'),
      opt(`skip:${thread}`, 'Skip'),
    ],
    context
  );

const SENSOR_PLAN_PROSE =
  'MR !739 ACME-2690 (sensors summary chip -> count). Round 1. 2 unresolved human threads, both adjudicated valid in a fresh context (opus). Recommend: fix thread 1 (the BLOCKING count-provenance finding), reply thread 2, approve code changes.';

const sensorProseQuestions = [
  proseThread(
    1,
    SENSOR_THREADS.t1,
    'readers.ts:796',
    'fix',
    `renee [BLOCKING], readers.ts:796: $tallyFilteredSensors derives the count's source badge from every leaf on each sensor row (pickLatestSourceFromProperties), but only description + row-existence decide the count. So a non-decider like $alias / $serialNumber can move the badge without the number changing (test :151 renders '2 sensors . RADAR' where RADAR is on no displayed sensor). Violates the pickLatestSource ACME-2560 JSDoc and panel-code-review item 2 (ALWAYS BLOCKING); lone outlier vs 5 sibling $tally* readers. Fresh-context adjudication (opus) confirmed every sub-point against the checkout. RECOMMEND fix: source off sensor.$summary (mirrors $tallyStationRelays), fix the JSDoc at :787-790, update the 2 tests pinning the old provenance. Draft reply: '${SENSOR_FIX_REPLY}'`
  ),
  proseThread(
    2,
    SENSOR_THREADS.t2,
    're-review (general thread)',
    'reply',
    `renee (general thread): 'Let me know when this is ready for re-review. Please reply or resolve this thread.' Procedural, not a code ask. RECOMMEND reply once the fix lands. Draft reply: '${SENSOR_REREVIEW_REPLY}'`
  ),
  codeChangesRecommended,
];

export const respondPlanProse: GalleryGate = {
  mr: MRS.sensorCount,
  gate: {
    gateId: 'gallery-respond-plan-prose',
    subject: mrSubject(739),
    kind: 'respond-plan',
    label: 'respond gate !739',
    status: 'open',
    openedAt: minutesAgo(35),
    meta: { label: 'respond gate !739' },
    domain: 'respond',
    origin: { presentation: 'form', surface: 'board', paneId: 'w12:p1' },
    context: SENSOR_PLAN_PROSE,
    questions: sensorProseQuestions,
  },
};

const postThread = (
  n: number,
  thread: string,
  file: string,
  resolveRecommended: boolean,
  resolveDescription: string,
  reply: { verb: 'reply' | 'fix'; text: string; sha?: string }
) =>
  question(
    `thread-${n}`,
    file,
    true,
    [
      opt(
        `post:${thread}`,
        'Post (Recommended)',
        'post this reply to the thread'
      ),
      opt(
        `resolve:${thread}`,
        resolveRecommended ? 'Resolve (Recommended)' : 'Resolve',
        resolveDescription
      ),
    ],
    ctx({
      'gate-ctx': 'reply@1',
      thread,
      file,
      verb: reply.verb,
      ...(reply.sha ? { sha: reply.sha } : {}),
      text: reply.text,
    })
  );

const RESOLVE = 'resolve the thread';

export const respondPost: GalleryGate = {
  mr: MRS.flagTargeting,
  gate: {
    gateId: 'gallery-respond-post',
    subject: mrSubject(774),
    kind: 'respond-post',
    label: 'respond gate !774',
    status: 'open',
    openedAt: minutesAgo(6),
    meta: { label: 'respond gate !774' },
    domain: 'respond',
    origin: { ...flagOrigin, worktree: `${TREES}/hazel` },
    context: ctx({
      'gate-ctx': 'post@1',
      reviewer: 'renee',
      round: 1,
      replies: 5,
      fixes: [{ sha: '8f7c05de' }, { sha: '77bf2129' }],
    }),
    questions: [
      postThread(1, FLAG_THREADS.t1, FLAG_FILES.t1, true, RESOLVE, {
        verb: 'fix',
        text: FLAG_REPLIES.t1,
      }),
      postThread(2, FLAG_THREADS.t2, FLAG_FILES.t2, true, RESOLVE, {
        verb: 'fix',
        sha: '8f7c05de',
        text: 'added a one-liner above both spreads in 8f7c05de.',
      }),
      postThread(3, FLAG_THREADS.t3, FLAG_FILES.t3, true, RESOLVE, {
        verb: 'fix',
        sha: '77bf2129',
        text: 'switched both to spread `requireActual` in 77bf2129. the spread drops `__esModule` though, so i set it back explicitly or `config` still resolves to the wrong object.',
      }),
      postThread(4, FLAG_THREADS.t4, FLAG_FILES.t4, true, RESOLVE, {
        verb: 'fix',
        text: '👍 linked both from the description.',
      }),
      postThread(5, FLAG_THREADS.t5, FLAG_FILES.t5, false, RESOLVE, {
        verb: 'reply',
        text: 'Ready for another look!',
      }),
    ],
  },
};

const FOLD_THREADS = {
  t1: 'bffa170656db21b8a757f57689c443622712f170',
  t2: 'b74efcaec28e6fcc0fe484ec4558666967df10cb',
};

const LEAVE_OPEN_RESOLVE =
  'resolve the thread (leave open for a pushback unless you want it closed)';

export const respondPostLongReplies: GalleryGate = {
  mr: MRS.stationFold,
  gate: {
    gateId: 'gallery-respond-post-long',
    subject: mrSubject(777),
    kind: 'respond-post',
    label: 'respond gate !777',
    status: 'open',
    openedAt: minutesAgo(14),
    meta: { label: 'respond gate !777' },
    domain: 'respond',
    origin: {
      presentation: 'form',
      surface: 'board',
      tabId: 'w19:t1',
      worktree: '/Users/pat/code/webapp',
      paneId: 'w19:p1',
    },
    context: ctx({
      'gate-ctx': 'post@1',
      reviewer: 'alex',
      round: 1,
      replies: 2,
    }),
    questions: [
      postThread(
        1,
        FOLD_THREADS.t1,
        'alignStationsForMerge.ts:66',
        false,
        LEAVE_OPEN_RESOLVE,
        {
          verb: 'reply',
          text: "yeah, deliberate. buoy/mast are safe to owner-key because the owner basically is the station (the buoy keeper, the mast operator). `Other` is the catch-all... `transformStationType` dumps anything unrecognized in there, and an `Other` station can carry a sensor + relay, so folding two `Other`s that just share an owner would collapse genuinely distinct stations. that's the 'operator of one mast who also keeps a buoy up the coast' case the scope-guard header already calls out, and the `keeps two genuinely distinct stations that share an owner separate` test guards it.\n\n`FloatingGauge` would actually be safe (owner-as-station, like mast), but it only comes out of the river-gauge self-serve signup flow, not the main transform path, and i haven't seen a dup-card clash for it. left it scoped to the ticket, can fold gauges in if one ever shows up.",
        }
      ),
      postThread(
        2,
        FOLD_THREADS.t2,
        'alignStationsForMerge.ts:93',
        false,
        LEAVE_OPEN_RESOLVE,
        {
          verb: 'reply',
          text: "good catch, contacts[0] isn't always the owner. the case that breaks it is a proxy-registered buoy/mast *primary* station... `transformPrimaryStationContacts` pushes the proxy at 0 and the owner at 1, so `ownerIdentity` would read the proxy.\n\nfor what the fold actually matches, though, it holds. `byOwner` only ever fires on non-primary buoy/mast stations, and those are single-contact by construction (backups dropped, one keeper per station), so `contacts[0]` is the owner there. the primary station matches earlier on the `isPrimaryStation` flag, before `byOwner` runs at all.\n\nthe real leak is that we still stamp ownerId onto the primary slot (`slot.ownerId ??= ownerId`), so a proxy-registered buoy primary stamps the proxy and could then miss a later non-primary station with the actual owner. narrow (buoy/mast primary + proxy-registered + same owner showing up elsewhere) and i think pre-existing to this defect.\n\ni'd skip `contacts.length === 1` regardless... it can't tell the proxy case from a self-registered owner who also has a caretaker (both len 2, but [0] is the owner in the second), and it'd null ownerId on legit primary slots and split real folds. if we want to close the gap i'd rather key off the actual owner contact instead of [0], or only owner-key non-primary stations. can pick that up as a follow-up.",
        }
      ),
    ],
  },
};

export const respondPostProse: GalleryGate = {
  mr: MRS.sensorCount,
  gate: {
    gateId: 'gallery-respond-post-prose',
    subject: mrSubject(739),
    kind: 'respond-post',
    label: 'respond gate !739',
    status: 'open',
    openedAt: minutesAgo(22),
    meta: { label: 'respond gate !739' },
    domain: 'respond',
    origin: {
      presentation: 'form',
      surface: 'board',
      tabId: 'w13:t1',
      worktree: '/Users/pat/code/webapp',
      paneId: 'w13:p1',
    },
    context:
      'MR !739 ACME-2690. Fix for thread 1 is implemented, verified (253 tests green) and pushed (commit 5f6dfaa5). Gate 2: which replies to post, and whether to resolve. Recommend: post both, leave-open (renee asked to re-review).',
    questions: [
      question(
        'replies',
        'Post which replies?',
        true,
        [
          opt(
            SENSOR_THREADS.t1,
            'readers.ts:796 (fix)',
            'fixed. sources off sensor.$summary now, matches $tallyStationRelays; jsdoc + tests updated.'
          ),
          opt(
            SENSOR_THREADS.t2,
            'Re-review thread',
            'addressed the finding on $tallyFilteredSensors. ready for re-review'
          ),
        ],
        "Fix is implemented + pushed (commit 5f6dfaa5). Two finalized replies ready. Recommend posting both.\n\nThread 89057e (readers.ts:796): 'fixed. $tallyFilteredSensors (readers.ts) sources off sensor.$summary now instead of every leaf on the row, so a non-decider like $alias can't move the badge. matches $tallyStationRelays. also fixed the jsdoc and the tests that were pinning the old provenance.'\n\nThread e71863 (re-review thread): 'addressed the count-provenance finding on $tallyFilteredSensors. ready for re-review'"
      ),
      question('disposition', 'Disposition', false, [
        opt(
          'leave-open',
          'Leave-open (Recommended)',
          "post the replies but don't resolve; renee asked to re-review, so let her verify and resolve"
        ),
        opt(
          'resolve-addressed',
          'Resolve-addressed',
          'resolve both threads now that the fix is in'
        ),
      ]),
    ],
  },
};

export const respondPostNoContext: GalleryGate = {
  mr: MRS.primaryContacts,
  gate: {
    gateId: 'gallery-respond-post-bare',
    subject: mrSubject(702),
    kind: 'respond-post',
    label: 'respond gate !702',
    status: 'open',
    openedAt: minutesAgo(48),
    meta: { label: 'respond gate !702' },
    domain: 'respond',
    origin: {
      presentation: 'wait',
      surface: 'board',
      paneId: 'w6:p2',
      tabId: 'w6:t2',
      worktree: '/Users/pat/code/webapp',
    },
    questions: [
      question('replies', 'Post which replies?', true, [
        opt(
          '755cf7763ec71adefbb8c0e1659662e4e1f9f54b',
          't1 ...PrimaryStationContacts.ts:898 (dropped relation)'
        ),
        opt(
          'fa9655b2601d19e4074c97d69779dc0a091826b7',
          't2 ...PrimaryStationContacts.ts:221 (comment + proxy test)'
        ),
        opt(
          'c24fdcb7053e31446a1e32d90f2f27876f6802d2',
          't3 ...PrimaryStationContacts.ts:224 (merge duplicates)'
        ),
        opt(
          'ced0b1316c4ff93f1f5ea33e0f94fd4f0251bfa8',
          't4 ...SensorCoverage.unit.test.ts:258 (covers key)'
        ),
        opt(
          '84f5e7dc1857acfa9931e264317a5516080f727d',
          't5 MR-level (partner note / e2e / ACME-3247)'
        ),
      ]),
      question('disposition', 'Disposition', false, [
        opt('resolve-addressed', 'Resolve-addressed'),
        opt('leave-open', 'Leave-open'),
      ]),
    ],
  },
};

// --- Review -----------------------------------------------------------------

const RADAR_FINDINGS = [
  {
    id: 'f1',
    severity: 'minor',
    title: 'Comment names the wrong teardown',
    body: '"can land after a step navigation tore this map down" isn\'t accurate after ACME-588: a step navigation no longer tears the map down, the provider teardown does (the same wording is in the test comment at useRadarMap.test.tsx:997). That\'s the exact distinction the render() comment warns about, and this wording invites someone to swap in isDetached, which would silently drop stations on the step showing the map.',
    file: 'packages/radar-map/src/layers/hooks/useRadarMap.ts:119',
    fix: 'reword to "can land after the provider tore this map down" (here and at useRadarMap.test.tsx:997)',
  },
  {
    id: 'f2',
    severity: 'minor',
    title: 'No test pins the case where a late model should still be added',
    body: "Every test in the file still passes if the guard is changed to isDetached.current, so the one plausible regression of this fix goes uncaught. Mirror \"keeps rendering the 3d layer after the step that built the map unmounts\": hold model loads, render tree('legend') and settle, rerender(tree('tracks')), release the held loads, then expect layers.add called once and dispatchLayerAction to get storeLayerObject.",
    file: 'packages/radar-map/src/layers/hooks/useRadarMap.test.tsx:1001',
    fix: 'add a test where the building step unmounts with the provider alive and the late model is still added',
  },
  {
    id: 'f3',
    severity: 'minor',
    title: '"Without this the test goes vacuous" overstates',
    body: 'Without the map.removed assertion, expect(layers.add).not.toHaveBeenCalled() still fails when the guard is missing; only the not.toThrow half (the tracker repro) would go vacuous.',
    file: 'packages/radar-map/src/layers/hooks/useRadarMap.test.tsx:1013',
    fix: 'say that the not.toThrow half would go vacuous',
  },
  {
    id: 'f4',
    severity: 'minor',
    title: 'Flag checklist item is ticked with no flag',
    body: 'Both the flag item and "Every flag state was exercised locally" are ticked in the MR description, but the change adds no flag.',
    fix: 'mark the flag item N/A with a one-line reason',
  },
];

const radarReviewQuestions = [
  question(
    'findings-1',
    'Post which findings to !812?',
    true,
    [
      opt(
        'f1',
        '[Minor] Comment names the wrong teardown',
        'packages/radar-map/src/layers/hooks/useRadarMap.ts:119 · reword to "can land after the provider tore this map down" (here and at useRadarMap.test.tsx:997) · kind:suggestion'
      ),
      opt(
        'f2',
        '[Minor] No test pins the case where a late model should still be added',
        'packages/radar-map/src/layers/hooks/useRadarMap.test.tsx:1001 · add a test where the building step unmounts with the provider alive and the late model is still added · kind:suggestion'
      ),
      opt(
        'f3',
        '[Minor] "Without this the test goes vacuous" overstates',
        'packages/radar-map/src/layers/hooks/useRadarMap.test.tsx:1013 · say that the not.toThrow half would go vacuous · kind:nitpick'
      ),
      opt(
        'f4',
        '[Minor] Flag checklist item is ticked with no flag',
        'MR description, not inline-anchorable · mark the flag item N/A with a one-line reason · kind:nitpick'
      ),
    ],
    ctx({ 'gate-ctx': 'findings@1', findings: RADAR_FINDINGS })
  ),
  question('outcome', 'Verdict on !812: ready to merge', false, [
    opt(
      'approve',
      'Approve (recommended)',
      'post the picked findings as non-blocking notes, then approve the MR'
    ),
    opt(
      'comment',
      'Comment',
      'post the picked findings and leave the merge decision open'
    ),
  ]),
];

const radarOrigin = {
  presentation: 'form' as const,
  surface: 'board',
  tabId: 'w34:t1',
  worktree: `${TREES}/juniper`,
  paneId: 'w34:p1',
  runId: '20260923-173405-6c1f-52210',
};

export const reviewPost: GalleryGate = {
  mr: MRS.radarLayers,
  gate: {
    gateId: 'gallery-review-post',
    subject: mrSubject(812),
    kind: 'review-post',
    label: 'review gate !812',
    status: 'open',
    openedAt: minutesAgo(12),
    meta: { label: 'review gate !812' },
    domain: 'review',
    origin: radarOrigin,
    context: ctx({
      'gate-ctx': 'review@1',
      readiness: 'yes',
      summary:
        "The guard matches the ticket's root cause and uses the provider flag that is set before the layer engine nulls world; the new test is red on main and green on the branch, and the attached browser A/B proves AC 1-2. The minors are polish, though f1 and f2 together guard the one plausible regression.",
      findings: { minor: 4 },
    }),
    questions: radarReviewQuestions,
  },
};

export const reviewPostVerdictOnly: GalleryGate = {
  mr: MRS.scriptFrames,
  gate: {
    gateId: 'gallery-review-verdict',
    subject: mrSubject(751),
    kind: 'review-post',
    label: 'review gate !751',
    status: 'open',
    openedAt: minutesAgo(18),
    meta: { label: 'review gate !751' },
    domain: 'review',
    origin: {
      presentation: 'form',
      surface: 'board',
      tabId: 'w30:t1',
      worktree: '/Users/pat/code/webapp',
      paneId: 'w30:p1',
    },
    context:
      'Readiness: yes. Re-review: the author addressed all three prior findings and the delta (two doc-comment edits plus one new test) is sound; the provenance question was confirmed against real 2026-09-23 events and hardened with a test for the absolute-URL frame form the send hook actually sees.\nFindings: none (all 3 prior findings addressed; f2/f3 resolved, f1 confirmed).',
    questions: [
      question(
        'outcome',
        'Verdict on !751: ready to merge, all prior feedback addressed',
        false,
        [
          opt(
            'approve',
            'Approve (recommended)',
            'all three prior findings addressed and hardened; nothing blocking, ready to merge'
          ),
          opt('comment', 'Comment', 'post a note without a merge decision'),
        ]
      ),
    ],
  },
};

const LINK_FINDINGS: Record<string, Opt> = {
  f1: opt(
    'f1',
    '[Important] AC 3\'s "zero GraphQL queries" is literally unmet: one query still fires',
    "not inline-anchorable (AC 3 wording vs residual region-config query) · Reconcile AC 3 'zero' wording with AC 7, or track region-config gating separately; do not block · kind:suggestion"
  ),
  f2: opt(
    'f2',
    '[Important] AC 6 and AC 7 are descoped to ACME-3336 and not delivered here',
    'not inline-anchorable (ticket scope) · Move ACs 6/7 onto ACME-3336 in the ticket, not just the MR; verify ACME-3336 covers both · kind:suggestion'
  ),
  f3: opt(
    'f3',
    '[Important] The evidence for AC 2 (kiosk no-regression) rests only on a mock',
    'not inline-anchorable (evidence) · Add a kiosk-path before/after, or a note that kiosk is covered by StartSessionContainer.test.tsx cases 3 and 4 · kind:suggestion'
  ),
  f4: opt(
    'f4',
    '[Minor] One-frame render change is benign (confirmed)',
    'not inline-anchorable (confirmation, no action) · None: confirmed no visible output and no side effect · kind:confirmation'
  ),
  f5: opt(
    'f5',
    '[Minor] staffToken is deferred (not stranded) when it coexists with an expired magic-link token',
    'apps/web/src/services/auth.tsx:258 · Optional one-line confirm the non-guestMode magic-link region routing to the expired page matches intent · kind:question'
  ),
};

const LINK_CONTEXT =
  "Readiness: with-fixes. Code is correct and requires no change; both defects are fixed, the token-expiry check fails open correctly and is only ever more permissive than the server, and nothing suppresses error codes. The remaining items are hygiene against the ticket's ACs: reconcile AC 3's 'zero queries' wording with the acknowledged residual, land the AC 6/7 descope on ACME-3336 in the ticket, and give AC 2's kiosk no-regression a line of real evidence.\nFindings: Important (3), Minor (2).";

const linkOutcome = question(
  'outcome',
  'Verdict on !760: ready once ticket/AC reconciliation and AC-2 evidence land (no code change needed)',
  false,
  [
    opt(
      'comment',
      'Comment (recommended)',
      'Post the picked findings; leave the merge decision to the author until the ticket/AC and evidence items are addressed'
    ),
    opt(
      'approve',
      'Approve',
      'Approve and post the picked findings, treating the three Important items as non-blocking hygiene the author follows up'
    ),
  ]
);

const linkReviewGate = (
  gateId: string,
  minutes: number,
  questions: GateQuestion[]
): GalleryGate => ({
  mr: MRS.expiredLinks,
  gate: {
    gateId,
    subject: mrSubject(760),
    kind: 'review-post',
    label: 'review gate !760',
    status: 'open',
    openedAt: minutesAgo(minutes),
    meta: { label: 'review gate !760' },
    domain: 'review',
    origin: {
      presentation: 'form',
      surface: 'board',
      tabId: 'w24:t2',
      worktree: '/Users/pat/code/webapp',
      paneId: 'w24:p2',
    },
    context: LINK_CONTEXT,
    questions,
  },
});

const pick = (...ids: string[]) => ids.map(id => LINK_FINDINGS[id]!);

export const reviewPostProseBySeverity = linkReviewGate(
  'gallery-review-by-severity',
  26,
  [
    question(
      'findings-1',
      'Post which findings to !760? (Important)',
      true,
      pick('f1', 'f2', 'f3')
    ),
    question(
      'findings-2',
      'Post which findings to !760? (Minor)',
      true,
      pick('f4', 'f5')
    ),
    linkOutcome,
  ]
);

export const reviewPostProseByCount = linkReviewGate(
  'gallery-review-by-count',
  27,
  [
    question(
      'findings-1',
      'Post which findings to !760?',
      true,
      pick('f1', 'f2', 'f3', 'f4')
    ),
    question(
      'findings-2',
      'Post which findings to !760? (continued)',
      true,
      pick('f5')
    ),
    linkOutcome,
  ]
);

// --- Stage ------------------------------------------------------------------

const runGate = (
  run: string,
  tree: string,
  paneId: string,
  gate: Omit<GateRow, 'subject' | 'status' | 'origin' | 'label'> & {
    label?: string;
  }
): GalleryGate => ({
  gate: {
    ...gate,
    label: gate.label ?? gate.kind,
    subject: `run:${run}`,
    status: 'open',
    origin: {
      presentation: 'form',
      paneId,
      runId: run,
      worktree: `${TREES}/${tree}`,
    },
  },
});

const NEXT_OPTIONS = {
  proceed: opt('proceed', 'Proceed (Recommended)'),
  iterate: opt('iterate', 'Iterate here'),
  goback: opt('goback', 'Go back'),
  implement: opt('redirect', 'Go back to implement'),
  hold: opt('hold', 'Hold'),
};

const SHIP_RUN = '20260923-120211-5f2e-41377';
const FRONT_RUN = '20260923-120135-2b7a-60412';
const TRACKER_RUN = '20260923-124251-8d03-26614';
const OWNER_RUN = '20260923-124302-4c9d-51730';

export const close = runGate(SHIP_RUN, 'alder', 'w27:p5', {
  gateId: 'gallery-close',
  kind: 'close',
  openedAt: minutesAgo(5),
  context:
    'MR !846 (https://gitlab.example.com/acme/webapp/-/merge_requests/846) is ready for review (no longer draft), squash on, label preview-env. CI verdict: green on pipeline 7310928416 after retrying four infra failures (forge checkout overload x3, preview env deploy health timeout x1); dependency-scan non-blocking and not in this diff. Five commits: HintBubble, StationBadge, four-site migration, Space/Enter parity, held-Space fix.',
  questions: [
    question('next', 'Close the ACME-3104 run?', false, [
      opt('done', 'Done (Recommended)', 'CI green, MR ready for review'),
      NEXT_OPTIONS.iterate,
      NEXT_OPTIONS.goback,
      NEXT_OPTIONS.hold,
    ]),
  ],
});

export const markReady = runGate(SHIP_RUN, 'alder', 'w27:p5', {
  gateId: 'gallery-mark-ready',
  kind: 'mark-ready',
  openedAt: minutesAgo(7),
  context:
    "CI is green for MR !846 (https://gitlab.example.com/acme/webapp/-/merge_requests/846), head 64bcc67bd5a, pipeline 7310928416. Blocking failures on the first pass were all infra and passed on retry: format:e2e, web:spellcheck and schema-breaking-changes hit 'the forge is currently unable to handle this request due to load' during checkout; preview:deploy timed out waiting for deploy app preview-env-846 to go Healthy. Only non-blocking failure: dependency-scan (known noisy, allow_failure), and none of its 24 flagged paths is in this diff. Evidence: six before/after composites (light and dark, trigger Tab-focused) embedded in the MR description. MR is draft, squash on, label preview-env.",
  questions: [
    question('ready', 'Mark MR !846 ready for review?', false, [
      opt(
        'ready',
        'Mark ready now (Recommended)',
        'CI green, before/after evidence for all six surfaces embedded'
      ),
      opt('draft', 'Keep it draft'),
    ]),
    question('next', 'Next', false, [
      NEXT_OPTIONS.proceed,
      NEXT_OPTIONS.iterate,
      NEXT_OPTIONS.goback,
      NEXT_OPTIONS.hold,
    ]),
  ],
});

export const ship = runGate(FRONT_RUN, 'cedar', 'w27:p3', {
  gateId: 'gallery-ship',
  kind: 'ship',
  openedAt: minutesAgo(11),
  context:
    'Branch acme-2217-station-markers-and-terrain-icons-m is in sync with origin (HEAD 9c8bb574b44, pushed by the mr-board doctor). Tree clean. Draft MR !821 already open: https://gitlab.example.com/acme/webapp/-/merge_requests/821 (squash on, label preview-env). Nothing new to push; the MR description still matches the change (the allowlist commit needs no mention).',
  questions: [
    question(
      'mr_open',
      'MR !821 is already open and up to date. What should ship do?',
      false,
      [
        opt('nothing', 'Nothing to push, go watch CI (Recommended)'),
        opt('update-description', 'Update the description'),
      ]
    ),
    question('open_as', 'Keep the MR as', false, [
      opt('draft', 'Draft (Recommended)'),
      opt('ready', 'Ready'),
    ]),
    question('next', 'Next', false, [
      NEXT_OPTIONS.proceed,
      NEXT_OPTIONS.iterate,
      NEXT_OPTIONS.hold,
    ]),
  ],
});

export const shipWinningAnswer: GateAnswers = {
  mr_open: 'nothing',
  open_as: 'draft',
  next: 'proceed',
};

export const selfReview = runGate(FRONT_RUN, 'cedar', 'w27:p3', {
  gateId: 'gallery-self-review',
  kind: 'self-review',
  openedAt: minutesAgo(15),
  context:
    'Delta reviewed: b6e27d49858..9c8bb574b44 (mr-board doctor commit "ACME-2217: doctor: lint allowlist graupel and virga for spellcheck").\nReviewer: Ready to merge? Yes. Critical: none. Important: none. Minor: none.\n"The two added words are real weather nouns, correctly sorted and formatted, and match the api allowlist. The commit changes nothing else." (apps/api/spelling-allowlist.txt already lists graupel:588 and virga:1702.)\nspell:changed passes locally. Pipeline 7310877301 on 9c8bb574b44 is running; the doctor holds the CI lease.',
  questions: [
    question(
      'fix',
      'The allowlist delta review came back clean. How should I continue?',
      false,
      [
        opt('none', 'Ship as is (Recommended)', 'no findings'),
        opt('blocking', 'Fix the blocking findings now'),
        opt('all', 'Fix the minors too'),
      ]
    ),
    question('next', 'Next', false, [
      NEXT_OPTIONS.proceed,
      NEXT_OPTIONS.iterate,
      NEXT_OPTIONS.hold,
    ]),
  ],
});

export const ciWatchStage = runGate(FRONT_RUN, 'cedar', 'w27:p3', {
  gateId: 'gallery-ci-watch-1',
  kind: 'ci:watch-ci:1',
  openedAt: minutesAgo(38),
  context:
    'summary: 1 blocking failure(s) (1 yours, 0 inherited), 1 non-blocking failure(s)\njob: web:spellcheck (id 90398861520) verdict: UNCLEAR ownership: yours\nWeb spellcheck failed on changed lines:\nsrc/components/Forecast/utils/precipitationLabel.ts:119:70 - Unknown word (graupel)\nsrc/components/Forecast/utils/precipitationLabel.ts:119:94 - Unknown word (virga)\n  2. Add legitimate domain terms to apps/web/spelling-allowlist.txt (one word per line).\nNon-blocking: dependency-scan (known noisy, allow_failure).\nPlanned fix: add graupel and virga to apps/web/spelling-allowlist.txt (both are real weather nouns mirrored from the api classifier), run spell:changed locally, push.',
  questions: [
    question(
      'action',
      'Spellcheck flagged two nouns in the new precipitation regex. What should I do?',
      false,
      [
        opt(
          'fix',
          'Fix and re-push (Recommended)',
          'allowlist graupel and virga; real weather nouns from the api list'
        ),
        opt('retry', 'Retry the job'),
        opt('handback', 'Hand back (leave it red)'),
        opt('abandon', 'Abandon the run'),
      ]
    ),
    question('next', 'Next', false, [
      NEXT_OPTIONS.proceed,
      NEXT_OPTIONS.iterate,
      NEXT_OPTIONS.implement,
      NEXT_OPTIONS.hold,
    ]),
  ],
});

export const clarify = runGate(TRACKER_RUN, 'birch', 'w29:p4', {
  gateId: 'gallery-clarify',
  kind: 'clarify',
  openedAt: minutesAgo(52),
  context:
    "MR !833 is draft, pipeline 7310860245 running, preview-env still building. AC4: 'Two api exceptions from different operations land in different tracker issues. Demonstrated by forcing two distinct resolver throws and showing two issue ids.'\nProduction web builds do not expose the GraphQL client (the devtools hook is dev-only), so forcing throws on the preview means finding UI flows whose resolvers fail there.\nWhat I have now (~/evidence/birch/acme-3350/tracker-events-after.json): a real tracker 4.2 client with the new duplicate filter, fed through handleGraphqlError, sent 4 events: SearchStationReadings fingerprint [gql-failure, SearchStationReadings, none, searchStationReadings]; three RadarPanelForStation rows all fingerprint [gql-failure, RadarPanelForStation, none, radarAlertsForStation.edges[].node.createdByOperator] with indexed paths 0/1/2 kept in extra.gql, locations as '4:9' strings.",
  questions: [
    question(
      'ac4',
      'How should I cover AC4 (two operations land in two tracker issues)?',
      false,
      [
        opt(
          'payload-now',
          'Attach real-client event payloads now, check issue ids post-deploy (Recommended)',
          'proves distinct fingerprints and no loss to duplicate filtering today; live issue ids come with the AC7/AC8 tracker queries'
        ),
        opt(
          'drive-preview',
          'Drive the preview env to force two failures',
          'the browser driver on the preview, trigger two failing operations through the UI, read the issue ids in the tracker; needs a tracker login in Chrome and paths that fail on preview, likely an hour'
        ),
        opt('hold', 'Hold for Pat'),
      ]
    ),
  ],
});

const OWNER_EVIDENCE =
  'EVIDENCE: data-shape -- behavior changes only when a directory lookup fails; evidence is a GraphQL response plus a getOwner call count with a forced rejection.';

export const evidence = runGate(OWNER_RUN, 'maple', 'w29:p5', {
  gateId: 'gallery-evidence',
  kind: 'evidence',
  openedAt: minutesAgo(64),
  context: `${OWNER_EVIDENCE} Ticket AC: "One realistic radar page load with a reading whose owner does not resolve is measured before and after, showing the Directory API call count for that id is bounded." Dev servers for this worktree are not running (port lookup: no ports allocated). A transient 429 cannot be induced on a live stack without a temporary code hack; a deleted-owner id throws on the parent owner lookup so the StationOwner children never run.`,
  questions: [
    question(
      'method',
      'How should the before/after call-count evidence be captured?',
      false,
      [
        opt(
          'harness',
          'Scripted GraphQL execution (Recommended)',
          'execute a panel-shaped { owner { id name email } } selection through the served schema with getOwner instrumented (count calls; reject on demand); before on main vs after on branch, saved as a transcript'
        ),
        opt(
          'live',
          'Live local stack',
          'start api + web, load a radar panel; needs a temporary code hack to force a transient directory rejection, since a real 429 cannot be induced'
        ),
        opt('both', 'Both'),
      ]
    ),
    question('next', 'Next?', false, [
      NEXT_OPTIONS.proceed,
      NEXT_OPTIONS.iterate,
      NEXT_OPTIONS.hold,
    ]),
  ],
});

export const plan = runGate(OWNER_RUN, 'maple', 'w29:p5', {
  gateId: 'gallery-plan',
  kind: 'plan',
  openedAt: minutesAgo(95),
  escalatedAt: minutesAgo(85),
  context: `ACME-3478: guard the per-field directory lookups in StationOwner (email/name/firstName/lastName/callSign), the new schema (graphql-schema/types/directory/StationOwner.ts) and the legacy schema (types/StationOwner.ts) in lockstep. APPROACH: test-first -- two resolver files, existing guard pattern (ACME-3190 createdByOperator) and parity harness. FAILING TEST: per-field "degrades to the inherited fallback on both schemas when the directory lookup rejects" in StationOwner.parallel.test.ts. ${OWNER_EVIDENCE} KIOSK GATES: no. Design: try/catch alone still costs one Directory API call per selected field (fails the bounded-call-count AC); proposal is a shared helper both schemas import that memoizes one guarded getOwner promise per StationOwner source object (WeakMap), logs logger.warn("[StationOwner] Error fetching owner", { ownerId, err }) matching !719, and returns undefined so the existing ?? "" / ?. fallbacks apply. Note: ACME-3402 (RadarReading.owner guard) is not on main yet.`,
  questions: [
    question('tier', 'Tier for ACME-3478?', false, [
      opt(
        'test-first',
        'test-first (Recommended)',
        'existing guard pattern plus parity harness; failing test first'
      ),
      opt('full-chain', 'Full chain', 'full brainstorm/spec/plan chain'),
      opt('trivial', 'Trivial', 'no test (not appropriate: behavior change)'),
    ]),
    question(
      'failing_test',
      "Failing test: per-field 'degrades to the inherited fallback on both schemas when the directory lookup rejects' (5 cases). Keep?",
      false,
      [
        opt('keep', 'Keep as named (Recommended)'),
        opt('rename', 'Rename (type the name in the note)'),
      ]
    ),
    question('scope', 'Guard shape?', false, [
      opt(
        'guard+memo',
        'Guard + per-source memo (Recommended)',
        'shared helper, one guarded getOwner per StationOwner object; meets the bounded-call-count AC'
      ),
      opt(
        'guard-only',
        'try/catch only',
        'minimal diff; one call per selected field remains, bounded AC not met'
      ),
    ]),
    question('validation', 'Local api validation: which runs are OK?', false, [
      opt(
        'scoped',
        'Scoped gates, CI arbitrates (Recommended)',
        'jest --selectProjects unit --testPathPattern=StationOwner; types:quick; lint:ci; lint:changed; format:agent'
      ),
      opt(
        'full-typecheck',
        'Scoped + full api type-check',
        'adds a cold pnpm --filter @acme/api type-check (~5 min, ~20 GiB)'
      ),
      opt('none', 'No local runs; CI only'),
    ]),
    question('next', 'Next?', false, [
      NEXT_OPTIONS.proceed,
      NEXT_OPTIONS.iterate,
      opt('redirect', 'Go back to provision'),
      NEXT_OPTIONS.hold,
    ]),
  ],
});

const HIGHLIGHTS_RUN = '20260915-141805-6a0e-33902';

export const ciWatchWaiting = runGate(HIGHLIGHTS_RUN, 'rowan', 'w5:pA', {
  gateId: 'gallery-ci-watch',
  kind: 'ci-watch',
  openedAt: minutesAgo(3),
  context: 'watch-pipeline.sh running in background for MR !715',
  questions: [
    question(
      'ci-verdict',
      'CI watcher running. This gate fires when the pipeline finishes.',
      false,
      [opt('green', 'Green'), opt('red', 'Red'), opt('hold', 'Hold')]
    ),
  ],
});

export const ciResult = runGate(HIGHLIGHTS_RUN, 'rowan', 'w5:pA', {
  gateId: 'gallery-ci-result',
  kind: 'ci-result',
  openedAt: minutesAgo(4),
  context: 'Waiting for CI on MR !715',
  questions: [
    question('result', 'CI finished. What next?', false, [
      opt('done', 'Done (Recommended)'),
      opt('fix', 'Fix and re-push'),
      opt('hold', 'Hold'),
    ]),
  ],
});

export const watchCi = runGate(HIGHLIGHTS_RUN, 'rowan', 'w5:pA', {
  gateId: 'gallery-watch-ci',
  kind: 'watch-ci',
  openedAt: minutesAgo(13),
  context:
    'Draft MR !715 on acme-2530-highlights-data-correctness. CI pipeline started. 5 highlights correctness fixes.',
  questions: [
    question(
      'action',
      'CI running on MR !715. Pipeline takes ~27min. What to do?',
      false,
      [opt('wait', 'Wait for CI (Recommended)'), opt('hold', 'Hold')]
    ),
  ],
});

export const selfReviewProgress = runGate(HIGHLIGHTS_RUN, 'rowan', 'w5:pA', {
  gateId: 'gallery-self-review-progress',
  kind: 'self-review-progress',
  openedAt: minutesAgo(38),
  context:
    'Fresh-context self-review of 6 commits (5 highlights fixes + 1 type-fix)',
  questions: [
    question(
      'action',
      'Fresh-context review running. Act on findings when done?',
      false,
      [opt('act', 'Act on findings (Recommended)'), opt('hold', 'Hold')]
    ),
  ],
});

export const implementProgress = runGate(HIGHLIGHTS_RUN, 'rowan', 'w5:pA', {
  gateId: 'gallery-implement-progress',
  kind: 'implement-progress',
  openedAt: minutesAgo(57),
  context:
    '5 parallel subagents: ACME-2543 wind transformer, ACME-2541 humidity CSV transform, ACME-2535 wind shift regex, ACME-2544 storm attempted-only, ACME-2542 large hail boolean fact',
  questions: [
    question(
      'status',
      '5 subagents implementing highlights fixes in parallel. Review results when they complete?',
      false,
      [opt('review', 'Review results (Recommended)'), opt('hold', 'Hold')]
    ),
  ],
});

export const evidenceAttach = runGate(
  '20260915-102402-9f14-58831',
  'spruce',
  'w7:p3',
  {
    gateId: 'gallery-evidence-attach',
    kind: 'evidence-attach',
    openedAt: minutesAgo(41),
    context:
      'Ship stage, evidence step 9 (AFTER capture) for ACME-2546. Station st_9jy1wi7c5h4h4fdyaygp: DB has Reading rd_odu2ycb51kpzvgwedxdm with frostAtDawn=true, zero frost alerts (the BEFORE repro, already captured). After restarting web+api post-rebase (pre-push hook briefly broke both dev servers -- fixed via the documented startup-failure triage), the UI still showed no Highlights section. Investigated via network capture: the Overview panels GetOverviewDataForStation query resolves latestReading to reading rd_3h53fc15km4um0ivakr6 (frostAtDawn=null), NOT rd_odu2ycb51kpzvgwedxdm. Tried a second single-reading station (st_tx6jbtlzicdvnfte5vfp) with the same result -- latestReading resolved to an orphaned reading (stationId=null in DB) instead of the frost-true reading. This is a pre-existing local seed-data / reading-station association inconsistency, confirmed across two independent stations, unrelated to the code change. The actual data source getFrostHighlights reads (ReadingAccessor via the shared getStationMergedReadingEntity query) was independently verified by the fresh-context reviewer by reading the .graphql fragment chain directly, and the fix is proven by 8/8 unit tests including a RED->GREEN TDD cycle.',
    questions: [
      question(
        'after_evidence',
        "AFTER screenshot blocked: local seed data confound. Tried 2 different local stations with Reading.frostAtDawn=true and no frost alerts. Overview panel's GetOverviewDataForStation query resolves latestReading to a DIFFERENT reading id than the one matching in the DB (an existing local seed-data association issue, not caused by this fix). BEFORE is captured; unit tests (RED->GREEN, 8/8) and independent reviewer verification of the GraphQL wiring prove correctness. How to proceed?",
        false,
        [
          opt(
            'mr_note',
            'Note the gap in the MR (Evidence section: BEFORE + tests + review, AFTER pending a working station), mark ready once CI is green (Recommended)'
          ),
          opt(
            'keep_trying',
            'Keep trying to find/fix a working local station for the AFTER screenshot'
          ),
          opt('hold', 'Hold'),
        ]
      ),
    ],
  }
);

export const evidenceFinding = runGate(
  '20260909-145932-3e8a-72015',
  'willow',
  'w3:p2',
  {
    gateId: 'gallery-evidence-finding',
    kind: 'evidence-finding',
    openedAt: minutesAgo(72),
    context: `AFTER capture is done on station st_troomhdsf5kwblqylc9s (26-5519034, 4 sensors), measured rather than eyeballed.

SENSOR READINGS, clean pass. viewport 2200, frame 1826: 4 cards at 444.50px filling the frame, overflow 0, no card overflowing its own box. It used to be a hardcoded w-[431px] card that always scrolled at 4 sensors. The reviewer flagged 431 -> 410 as the risk; that surface is fine.

KEY STATIONS AT ITS FLOOR, the condition Pat attached to accepting 410. viewport 1864, frame 1478: every column exactly 410.00px, content 1688px against 2300px under the old 562px peek floor, overflow 318px against roughly 822px. ForecastCard renders with no clipping (labels wrap to two lines); StationCodeBadges renders (station code wraps to two lines). NearbyStationCard does not appear on this station, so it stays unverified.

KEY STATIONS AT A WIDE FRAME, the finding. viewport 2200, frame 1814: columns 441.50px, and 4 * 441.5 + 3 * 16 = 1814, so the column maths is flush and the sticky rail measures exactly 1814. But the body row measures 1891, so 77px still scrolls. The cause is inside the card, not the width rule: two of the four card bodies hold a flex-nowrap Row with the radar column (250px, auto min) beside the sensor detail column (min-w-[260px]), and 250 + 8 gap + 260 = 518. A station card carrying a sensor cannot render narrower than ~518px whatever the column is set to.

So the ticket goal of no unnecessary horizontal scroll is met for sensor readings and improved but not reached for Key Stations. The remaining 77px is a pre-existing constraint this MR exposes rather than causes.`,
    questions: [
      question(
        'residual',
        'Key Stations still scrolls 77px at a wide frame, because a station card cannot render below ~518px. What now?',
        false,
        [
          opt(
            'wrap',
            'Let the card inner Row wrap (Recommended) - sensor details drop below the radar when the column is narrow, so the card honours the column width'
          ),
          opt(
            'ship',
            'Ship as is - the rule is right, the 518px card floor predates this MR; file a follow-up'
          ),
          opt(
            'raise',
            'Raise Key Stations floor to 518px so the promise matches what the card can render (breaks alignment with sensor readings at 410)'
          ),
        ]
      ),
      question(
        'apc',
        'NearbyStationCard was not on this station, so 410px is unverified for it. Accept?',
        false,
        [
          opt('accept', 'Accept and say so in the MR (Recommended)'),
          opt('find-station', 'Find a station that has one and capture it too'),
        ]
      ),
      question('next', 'Proceed from here?', false, [
        opt(
          'proceed',
          'Proceed: finish the MR description and hand to CI (Recommended)'
        ),
        opt('iterate', 'Iterate here (say what to change in the note)'),
        opt('hold', 'Hold'),
      ]),
    ],
  }
);

const DEV_RUN = '20260909-111345-7b21-15530';
const DEV_TREE = `${TREES}/aspen`;

export const login: GalleryGate = {
  gate: {
    gateId: 'gallery-login',
    subject: `run:${DEV_RUN}`,
    kind: 'login',
    label: 'login',
    status: 'open',
    openedAt: minutesAgo(9),
    meta: {
      runId: DEV_RUN,
      worktree: DEV_TREE,
      presentation: 'wait',
      context:
        'Both dev servers are running for worktree aspen: web http://localhost:4001, api http://localhost:10400 connected to the shared QA database through the db tunnel at 127.0.0.1:10012 (access valid until 7:38PM).\n\nWhat I need: an interactive login at http://localhost:4001. I will not log in as you.\n\nIf the app shows the signed-in-but-no-token limbo (it looks logged in, the avatar is stale, logout does not settle, and station pages bounce to legacy /stations/): DevTools > Application > Storage > Clear site data on localhost:4001, reload, then log in for real. That clears the two stale `auth.<clientId>.is.authenticated` marker cookies that make the SDK believe it holds a session it does not have.\n\nTo confirm it worked before answering, open:\nhttp://localhost:4001/s/st_k5ddxrz4x4i64o26m8ud/readings/rd_es9ht0kez2aiqf6brnce\nIt should render the Overview chip "1 station and 1 relay reporting" rather than redirecting to /stations/.\n\nOnce you answer, I capture all four BEFORE stations into .plans/evidence/after/ and post them as a comment on !690. Expected: station A\'s Overview chip unchanged and its Radar drift chip now absent (the accepted cost, ACME-3122); station B the relay control unchanged on both surfaces; stations C and D unchanged with no drift chip either way. If station A\'s drift card still renders, that is a failure and I will say so plainly.\n',
      paneId: 'w4:pC',
    },
    questions: [
      question(
        'login',
        'Both dev servers are up (web 4001, api 10400 on the shared QA database). I need an interactive login at http://localhost:4001 before I can capture the AFTER evidence. Tell me when it is done.',
        false,
        [
          opt('logged-in', 'Logged in. Capture now.'),
          opt(
            'cleared-and-logged-in',
            'Hit the signed-in-but-no-token limbo, cleared site data, logged in. Capture now.'
          ),
          opt('cannot-login', 'Cannot log in. I will say what happened.'),
          opt(
            'skip-after',
            'Skip the after capture; go straight to watching CI.'
          ),
        ]
      ),
    ],
  },
};

export const next: GalleryGate = {
  gate: {
    gateId: 'gallery-next',
    subject: `run:${DEV_RUN}`,
    kind: 'next',
    label: 'next',
    status: 'open',
    openedAt: minutesAgo(21),
    meta: {
      runId: DEV_RUN,
      worktree: DEV_TREE,
      presentation: 'wait',
      context:
        "State changed while this pane was idle, all of it verified just now rather than assumed.\n\nACME-3087 was merged to main (d7828f8d7e8) and its remote branch deleted, so the stacked target is gone. This branch was rebased onto main and pushed by the developer; local HEAD equals origin at b347836a680. MR !690 is open as Draft against main, labelled ACME and preview-env, carrying the description I drafted (5105 bytes, tradeoff section present, no image uploads yet).\n\nThe rebase is sound. On the rebased tree: `pnpm --filter @acme/web type-check:kiosk` exits 0, and jest over the three affected trees is 133 suites / 2443 passed / 2 skipped / 0 failed. ACME-3087's `StationRelayAccessor.isRelayed` is present in the tree and `reportingRelayStations` still reads it, so nothing my change depends on was lost in the rebase.\n\nCI pipeline 7310501976 is still running; `build:test-image` has not finished, so the type-check and jest jobs have not started. One failure so far: `dependency-scan`. My diff touches no package.json, lockfile or other dependency manifest, so that job is not attributable to this change.\n\nStill outstanding: the AFTER screenshot (both dev servers were killed by the OS for low memory, so they need restarting, and the app still needs an interactive login I will not perform), and the card-loss follow-up ticket, which is drafted in my published report and deliberately not filed.\n",
      paneId: 'w4:pC',
    },
    questions: [
      question(
        'next',
        'MR !690 is open as a draft on main and CI is mid-flight. What next?',
        false,
        [
          opt(
            'watch-ci',
            'Watch CI to green and triage failures (Recommended). The type-check and jest jobs have not started yet; the dependency scan failed but touches no dependency I changed.'
          ),
          opt(
            'after-evidence',
            'Restart the dev servers and capture the after screenshot first. Needs you to log in at localhost:4001 once they are up.'
          ),
          opt(
            'both',
            'Both: capture the after evidence, then watch CI through to green.'
          ),
          opt('park', 'Nothing more. Leave it parked and I stop here.'),
        ]
      ),
    ],
  },
};

export const ciFix = runGate('20260909-111113-c4d2-90318', 'cedar', 'w4:pB', {
  gateId: 'gallery-ci-fix',
  kind: 'ci-fix',
  openedAt: minutesAgo(24),
  context: `Pipeline 7310493358 on 53486ee3fc4. Task-runner verdict: 81 of 82 type-check tasks passed, the single failure is @acme/api. The 197 @acme/web error lines in that log are NOT a failure... web passed. dependency-scan, test:api:quarantine, check:forecast-schema:field-accounting and check:forecast-schema:domain-drift all failed but are allow_failure:true, and the field-accounting job prints that it is pre-existing main debt, not caused by this MR.

Two real blocking failures, both mine:

1. check:types -- 7 type errors, all in my own api TEST files. apps/api/tsconfig.types-quick.json EXCLUDES src/**/*.test.ts, so types:quick could never have shown these however many times I ran it. Errors: the narrowed freshIconTypeForCloudClassification input no longer accepts a "type" property (5 call sites), CloudCategory.cumulus should be .CUMULUS, and one fixture needed "as unknown as Reading".

2. test:ci:api 1/4 -- exactly 1 failing test out of 17403. determineIconTypeUnified.test.ts "uses the user-selected overcast icon when classification persisted OVERCAST_FULL" expected OVERCAST_FULL, got CUMULONIMBUS. That test asserts the defect this MR exists to fix: a persisted OVERCAST_FULL on a CUMULONIMBUS_TOWERING cell. I rewrote it to assert the re-derived CUMULONIMBUS and left a comment saying what changed and why. This is the one change worth your eye, because it edits an existing test expectation rather than adding one.

Fix committed locally as 53486ee3fc4, not pushed. Verified with jest across all five affected suites: 5 passed, 1743 tests, 1 skipped. ts-jest type-checks as it runs, so the type errors are covered too, but that is not the same program CI type-checks.

The recommended option runs "pnpm --filter @acme/api type-check" (the full tsc, which unlike lite does include test files). Repo AGENTS.md says it runs freely and is seconds when warm; your ~/.agent/rules/api-typecheck-safety.md says never run it and use lite instead. Lite is exactly what missed this, so I am asking rather than picking.`,
  questions: [
    question(
      'ci_fix',
      'CI went red on two jobs, both mine. Fix is committed locally at 53486ee3fc4. Push it?',
      false,
      [
        opt(
          'verify-then-push',
          'Run the full api type-check first, then push (Recommended)'
        ),
        opt(
          'push-now',
          'Push now, let CI verify (jest already passes on all 5 affected suites)'
        ),
        opt('hold', 'Hold: I stop, you review the fix commit yourself'),
        opt('iterate', 'Change something about the fix first (say what)'),
      ]
    ),
  ],
});

export const confirm: GalleryGate = {
  gate: {
    gateId: 'gallery-confirm',
    subject: 'run:20260908-141502-d7a3-40196',
    kind: 'confirm',
    label: 'confirm (design baseline)',
    status: 'open',
    openedAt: minutesAgo(16),
    meta: { label: 'confirm (design baseline)' },
    context:
      '**Baseline gate** for the triage-modal design pass; closed after capture.',
    questions: [
      question(
        'flaky',
        'How should the flaky session-cache test be handled?',
        false,
        [
          opt('quarantine', 'Quarantine it and file a ticket (recommended)'),
          opt('fix-now', 'Fix it in this run'),
          opt('leave', 'Leave it as is'),
        ]
      ),
      question('extras', 'Include in the MR note', true, [
        opt('screenshot', 'The failure screenshot'),
        opt('ping', 'A ping to the ticket owner'),
        opt('runbook', 'A link to the runbook'),
      ]),
    ],
  },
};

export const validation: GalleryGate = {
  gate: {
    gateId: 'gallery-validation',
    subject: 'run:20260908-163645-a2c4-11873',
    kind: 'validation',
    label: 'click routing validation',
    status: 'open',
    openedAt: minutesAgo(2),
    meta: { label: 'click routing validation' },
    context:
      'Scratch gate opened by paul to validate gate notification click routing. Safe to ignore; it will be closed after the check.',
    questions: [
      question('validation', 'Did this land on the right gate card?', false, [
        'yes',
        'no',
      ]),
    ],
  },
};

export const approval: GalleryGate = {
  gate: {
    gateId: 'gallery-approval',
    subject: 'run:20260905-224950-51bd-66702',
    kind: 'approval',
    label: 'approval',
    status: 'open',
    openedAt: minutesAgo(8),
    origin: { paneId: 'w2:pC', worktree: '/tmp/scratch', presentation: 'form' },
    context:
      'Second decision on the same run: the canary window closed clean (0 drops, p99 flat). This gate exists to verify remote completion.',
    questions: [
      question('proceed', 'Ship the drain-barrier fix?', false, [
        opt('ship', 'Ship it'),
        opt('defer', 'Defer to the next train'),
      ]),
    ],
  },
};

// --- Herd and milestone -----------------------------------------------------

const STYLE_HERD = 'style-lookup-20260922-215458';

export const herdQuestion: GalleryGate = {
  gate: {
    gateId: 'gallery-herd-question',
    subject: `herd:${STYLE_HERD}/lookup-check`,
    kind: 'question',
    label: 'question',
    status: 'open',
    openedAt: minutesAgo(4),
    meta: { herd: STYLE_HERD, job: 'lookup-check' },
    origin: { presentation: 'form', paneId: 'w31:p1' },
    context:
      "Everything else is done: tools#14 merged (0.8.0), team pack 0.4.12 published and synced, webapp#212 merged and pulled. The !812 board review ran on team pack 0.4.12. Its transcript shows the lookup worked: tool search select rt_verb, then rt_verb skills writing-style show returned pat:writing-style (source preferences), then the skill loaded at 22:36:27Z, before drafting. It drafted 4 Minor findings. The drafts have no em or en dashes and no praise opener on any finding, and each leads with the problem and ends with a Fix. Since about 5:44 pm it has been sitting at its own pane-local posting form in w34:p1 (Reviews · renee) waiting for someone to pick findings, and nothing is on the MR. Option 1 writes the final report from the transcript and drafts and leaves the pane for you to handle. Option 2: I wait for real comments and check them. Posting touches a colleague's MR, so posting is your call either way. The generic board path stays unverified live under every option.",
    questions: [
      question(
        'q1',
        'The !812 review is waiting at its posting form in pane w34:p1. How should the end-to-end check finish?',
        false,
        [
          'Report now on the lookup evidence and the drafted text; skip posting',
          'I will pick findings in pane w34:p1 and post; wait for the comments',
          'Close the review without posting and skip the end-to-end check',
        ].map(v => opt(v, v))
      ),
    ],
  },
};

const SETTINGS_HERD = 'settings-page-20260923-001230';

export const milestone: GalleryGate = {
  gate: {
    gateId: 'gallery-milestone',
    subject: `herd:${SETTINGS_HERD}/settings-ship`,
    kind: 'milestone',
    label: 'milestone',
    status: 'open',
    openedAt: minutesAgo(28),
    meta: {
      herd: SETTINGS_HERD,
      job: 'settings-ship',
      artifact:
        '/Users/pat/worktrees/gh-acme-tools/calm-meadow/.plans/parity-milestone.md',
      message: 2291,
    },
    origin: { presentation: 'form', paneId: 'w18:p4' },
    questions: [
      question(
        'decision',
        'Revision 3: title row and filter toolbar live in AppFrame.Header, so the scroll frame and scrollbar start below them; the stuck-closed drawer is confirmed and reported, not fixed',
        false,
        ['Approve', 'Revise', 'Spawn a reviewer'].map(v => opt(v, v))
      ),
    ],
  },
};

// --- Escalations ------------------------------------------------------------

export const ciWatchEscalated = runGate(TRACKER_RUN, 'birch', 'w29:p4', {
  gateId: 'gallery-ci-watch-2',
  kind: 'ci:watch-ci:2',
  openedAt: minutesAgo(46),
  escalatedAt: minutesAgo(36),
  context:
    "Pipeline 7310915086 (MR !833, sha 3a89526891f): 36 success; lint-review now green. Only remaining job preview:build:static (running).\nformat:e2e (job 90412203771, blocking): INFRA flake, not mine (diff does not touch packages/e2e). Trace: 'fatal: remote error: the forge is currently unable to handle this request due to load (ID 5e0b7c91d24a86f3-ORD).' then 'ERROR: Job failed: command terminated with exit code 1'. Not retried yet.\ndependency-scan red is allow_failure.\nCI attendant lease on this MR is held by holder=doctor sessionLabel=mr-board-triage (heartbeat current), so a retry from this pane needs the lease or the shepherd's say-so.",
  questions: [
    question(
      'action',
      'format:e2e (blocking) failed on a forge clone flake, not my change. What should I do?',
      false,
      [
        opt(
          'retry',
          'Retry the job (Recommended)',
          'retry format:e2e job 90412203771; the board doctor holds the attendant lease, so this answer also clears me to retry past it'
        ),
        opt(
          'wait-doctor',
          'Leave it to the board doctor',
          'it holds the lease but has not retried in ~40m'
        ),
        opt('handback', 'Hand back'),
        opt('abandon', 'Abandon the run'),
      ]
    ),
    question('next', 'Next?', false, [
      NEXT_OPTIONS.proceed,
      NEXT_OPTIONS.iterate,
      NEXT_OPTIONS.implement,
      NEXT_OPTIONS.hold,
    ]),
  ],
});

export const doctorEscalation: GalleryGate = {
  mr: MRS.highlights,
  gate: {
    gateId: 'gallery-doctor-escalation',
    subject: mrSubject(715),
    kind: 'doctor-escalation',
    label: 'doctor gate !715',
    status: 'open',
    openedAt: minutesAgo(33),
    meta: { label: 'doctor gate !715' },
    domain: 'doctor',
    origin: {
      presentation: 'form',
      surface: 'board',
      tabId: 'w9:t5',
      worktree: `${TREES}/rowan`,
      paneId: 'w9:p5',
    },
    context:
      "ACME-2530 highlights batch MR (!715, author pat). Rebasing onto origin/main (284 behind, 10 own commits) conflicts at branch ACME-2535 commit c27d499d (2026-09-15) in 3 files: windShift.fact.ts, its .test.ts, panelFacts.types.ts.\n\nSame-ticket supersede: main already carries a NEWER ACME-2535 commit 9b1e6aa9 (Alex Moreno, 2026-09-17) titled 'ACME-2535: drop the Wind shift card for CALM_AIR rows'. Main returns null for CALM_AIR, routes those rows to the Wind-conditions chip, and removes the windShiftCalm type key. The branch instead ADDS a neutral 'air was calm' card (factKey windShiftCalm) for the same rows, and has a follow-up commit a71b63ea refining that card, so both branch ACME-2535 commits are entangled.\n\nEffect:\n- keep-main: drop the branch superseded ACME-2535 work; MR loses ACME-2535 (already on main in final form). The other 4 fixes (ACME-2541/2543/2542/2544) still land. Recommended.\n- keep-branch: re-assert the branch neutral-card approach, reverting main deliberate 2026-09-17 drop-the-card decision.\n\nOperator note was rebase-only; this is a behavior-reversing pick-a-side, so escalating rather than guessing. Rebase aborted; worktree clean on pushed head 870f157.",
    questions: [
      question(
        'action',
        'Rebase conflict: main newer ACME-2535 drops the CALM_AIR Wind-shift card; this branch older ACME-2535 adds it. Which side wins?',
        false,
        [
          opt(
            'keep-main',
            'keep main ACME-2535 (drop the CALM_AIR card); drop this branch superseded ACME-2535 commits'
          ),
          opt(
            'keep-branch',
            'keep the MR branch ACME-2535 neutral card (override main drop)'
          ),
          opt('leave it to me in the pane', 'Leave it to me in the pane'),
        ]
      ),
    ],
  },
};

export const respondEscalation: GalleryGate = {
  mr: MRS.advisoryPlans,
  gate: {
    gateId: 'gallery-respond-escalation',
    subject: mrSubject(713),
    kind: 'respond-escalation',
    label: 'respond-escalation',
    status: 'open',
    openedAt: minutesAgo(19),
    origin: { presentation: 'form', paneId: 'w10:p1' },
    context: `MR !713 ACME-2538. Renee escalated the tier-5 thread we pushed back on: new top-level "Re-review summary -- changes requested" (19:16 UTC) and MR set to requested_changes.

RENEE'S ASK (verbatim): "Resolve the outstanding explicit-false provenance defect. Tier 5 reads $planToIssueAdditionalOtherStormAdvisory; when it explicitly answers false, preserve $planFlag as the source just as for true. Use an undefined source only when no tier asserts a result, and add a false-case test whose boolean and advisory-status leaves have distinct sources."

RE-CHECK VERDICT: Renee is right; our pushback's key point was wrong.
- Our reply said the guard "would give the negative a source no other tier has." False: tier 1 already does it at readers.ts:702-703 (NO_PLAN_TO_ISSUE_ADVISORY -> sourcedValue(false, station.$advisoryStatus)). Tier 5 sourcing its explicit false to $planFlag is consistent with tier 1, not a one-off. The fresh adjudicator compared tier 5 to tiers 2-4 (arrays, no explicit-negative form) and missed tier 1.
- File-wide pattern agrees: :299 and :1128 return sourcedValue(false, <deciding leaf>); :175 returns sourcedValue(false, undefined) for the truly-unasserted case. Renee's "undefined only when no tier asserts" is line 175.
- "Nothing renders the false case" is not durable: pickLatestSource.ts:37-39 (ACME-2560) anticipates .value===false leaves rendered on absence cards, sourced to the leaf that decided the value. An explicit boolean false sourced to a never-answered $advisoryStatus is exactly that wrong-deciding-leaf case.

SCOPE READ: "undefined source only when no tier asserts" is the principle, not a request to change the terminal; her first comment bracketed the terminal as "pre-existing and separate -- not asking for it here" and ACME-3301 lists terminal-false provenance as follow-up. Recommended: guard + test only, leave the terminal.

DRAFT CONCESSION REPLY (thread 3757ca16ba3d, Pat's voice):
"you're right, i had this backwards. tier 1 already sources its explicit NO_PLAN_TO_ISSUE_ADVISORY to $advisoryStatus, so an explicit boolean false sourced to $planFlag is the consistent move, not a one-off. added the guard and a false-case test with distinct boolean/status sources. left the terminal $advisoryStatus citation alone per your earlier note (ACME-3301 has it)."`,
    questions: [
      question(
        'escalation',
        "Renee's re-review holds against the code; how to proceed?",
        false,
        [
          opt(
            'concede-implement-reply',
            'Concede + implement + reply (Recommended)',
            'add the tier-5 explicit-false guard and a false-case test with distinct boolean/status sources, run the suite, push, post the concession reply; leave the terminal $advisoryStatus alone (Renee bracketed it; ACME-3301 owns it)'
          ),
          opt(
            'concede-also-terminal',
            'Concede + also fix the terminal',
            "same, plus change the terminal to sourcedValue(false, undefined) per line 175's pattern; flagged in the reply so Renee can object"
          ),
          opt(
            'hold',
            'Hold, I want to weigh in first',
            'post and change nothing yet'
          ),
        ]
      ),
    ],
  },
};

export const wrapUp: GalleryGate = {
  mr: MRS.pictograms,
  gate: {
    gateId: 'gallery-wrap-up',
    subject: mrSubject(688),
    kind: 'wrap-up',
    label: 'wrap-up',
    status: 'open',
    openedAt: minutesAgo(44),
    origin: { presentation: 'form', paneId: 'w14:p1' },
    context:
      'Doctor on !688 (ACME-3150, stacked on !671, target panel-model-split) reached terminal error. No merge conflicts. Sole blocking CI red: docs:links (14 broken markdown links in docs/, specs/, READMEs), verdict UNCLEAR, ownership INHERITED (fails identically on parent branch panel-model-split; unrelated to the pictogram/asset move). 0 blocking failures owned by this branch, 1 inherited. Doctor made no commits/pushes/retries and drafted a held inherited-failure note.',
    questions: [
      question(
        'note',
        'The doctor wrote a HELD note on !688 explaining the stand-down; it is not posted yet. What should happen to it?',
        false,
        [
          opt(
            'leave-held',
            'Leave it held (Recommended)',
            "Stays queued, not posted. It's your own MR and you know the context."
          ),
          opt(
            'post',
            'Post it to the MR',
            'Publishes the inherited-failure explanation as a visible comment on !688.'
          ),
          opt(
            'discard',
            'Discard it',
            'Drop the draft entirely, redundant since you authored the MR.'
          ),
        ]
      ),
      question(
        'md_links',
        'How do you want to handle the inherited docs:links failure (14 pre-existing broken links, also red on the parent)?',
        false,
        [
          opt(
            'leave-parent',
            'Leave it to the parent/stack (Recommended)',
            "Inherited, not this MR's. Rides on !671 / the stack root."
          ),
          opt(
            'check-staleness',
            'Check main staleness first',
            'Verify whether main already fixed some links before deciding.'
          ),
          opt(
            'fix-now',
            'Fix the 14 links now',
            'Standalone docs-link cleanup or link-baseline.json update.'
          ),
          opt(
            'skip',
            'Skip / ignore for now',
            "Take no action and don't track it here."
          ),
        ]
      ),
    ],
  },
};

// --- Pane -------------------------------------------------------------------

const RULE = '─'.repeat(120);

const TRUST_SCREEN = `∙ ## Messages
∙ Anything from the shepherd or a reviewer arrives in your context as a chat
∙ message (\`[#<room>] <handle> #<n>: ...\` or \`[dm] <handle> #<n>: ...\`).
∙ Reply with \`rt chat dm <handle> "..."\`, never with a direct agent message. A
∙ message that changes your task is a new instruction; a message that only
∙ informs needs no reply.
∙
∙ ## Git
∙ Commit incrementally on this branch. This job is the integration job, so it pushes: It pushes and opens PRs as the pla
n says (Task 1 in this worktree, Task 3 in its own tools worktree), pushes the team pack directly (that push is the p
ublish the operator approved), and merges a PR only on the operator'\\''s answer. Never force-push. Never push to main
 directly, except the team pack push above. Questions, milestones, and reports go through the \`rt herd\` commands ab
ove, never into the repo.
∙ Tooling that manages its own workspace inside the repo writes where that
∙ tooling specifies; the write fence lists those paths.
∙
∙ ## Delegation
∙ For searches, codebase exploration, and mechanical subtasks, dispatch
∙ subagents on cheaper models instead of doing them in your own context.
∙ Reserve your own turns for design decisions and the work itself.
∙ '
Account-2 (agent@example.com) is already the active default login... launching the agent directly.

${RULE}
 Accessing workspace:

 /Users/pat/.mattstack/teams/acme

 Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source
 project, or work from your team). If not, take a moment to review what's in this folder first.

 Claude Code'll be able to read, edit, and execute files here.

 Security guide

 ❯ No, exit
   Yes, I trust this folder

 Enter to confirm · Esc to cancel
`;

const paneTrust = (reason: 'blocked' | 'gone'): GalleryGate => ({
  gate: {
    gateId: `gallery-pane-${reason}`,
    subject: `herd:${STYLE_HERD}/lookup-check`,
    kind: 'pane-attention',
    label: 'pane-attention',
    status: 'open',
    openedAt: minutesAgo(reason === 'blocked' ? 2 : 17),
    meta: { agentId: 'ag-3c91a7e2', paneRef: 'w31:p1', reason },
    origin: { paneId: 'w31:p1', worktree: '/Users/pat/.mattstack/teams/acme' },
    context: TRUST_SCREEN,
    questions: [
      question('action', 'Pane needs attention', false, [
        opt('focus-pane', 'Focus-pane'),
        opt('resume', 'Resume'),
        opt('clear', 'Clear'),
        opt('dismiss', 'Dismiss'),
      ]),
    ],
  },
});

export const paneBlocked = paneTrust('blocked');
export const paneGone = paneTrust('gone');

// --- Answered states --------------------------------------------------------

export const answeredReview: GalleryGate = {
  mr: MRS.radarLayers,
  gate: {
    ...reviewPost.gate,
    gateId: 'gallery-answered-review',
    status: 'answered',
    answers: { 'findings-1': ['f1', 'f2', 'f3', 'f4'], outcome: 'approve' },
    answeredBy: 'board',
    answeredAt: minutesAgo(3),
    delivery: { outcome: 'confirmed', at: minutesAgo(2) },
  },
};

export const answeredRespondPost: GalleryGate = {
  mr: MRS.flagTargeting,
  gate: {
    ...respondPost.gate,
    gateId: 'gallery-answered-respond-post',
    status: 'answered',
    answers: Object.fromEntries(
      Object.values(FLAG_THREADS).map((thread, i) => [
        `thread-${i + 1}`,
        [`post:${thread}`, `resolve:${thread}`],
      ])
    ),
    answeredBy: 'board',
    answeredAt: minutesAgo(1),
    delivery: { outcome: 'confirmed', at: minutesAgo(1) },
  },
};

export const answeredMilestoneNote: GalleryGate = {
  gate: {
    ...milestone.gate,
    gateId: 'gallery-answered-milestone',
    status: 'answered',
    answers: {
      decision: {
        value: 'Approve',
        note: "Pat approves revision 3. Before opening the PR, fix the stuck-closed sidebar in the kit, per Pat's choice: AppFrame (useDrawerState or its caller) must not persist the close it forces in mobile mode, so a narrow-width load never saves drawerKey=false for desktop. Keep hideCollapse and drawerKey on the settings page. Failing test first in packages/ui (mobile load does not write false; a user toggle still persists). Then open the PR, wait for the review bot and CI, and stop before merge.",
      },
    },
    answeredBy: 'shepherd',
    answeredAt: minutesAgo(6),
    delivery: { outcome: 'confirmed', at: minutesAgo(5) },
  },
};

export const answeredInPane: GalleryGate = {
  mr: MRS.pictograms,
  gate: {
    ...wrapUp.gate,
    gateId: 'gallery-answered-in-pane',
    status: 'answered',
    answers: {
      note: {
        value: 'discard',
        note: 'Pat handling via gitq in another session',
      },
      md_links: 'leave-parent',
    },
    answeredBy: 'pane',
    answeredAt: minutesAgo(40),
  },
};

export const answerStuck: GalleryGate = {
  gate: {
    ...close.gate,
    gateId: 'gallery-answer-stuck',
    status: 'answered',
    answers: { next: 'done' },
    answeredBy: 'shepherd',
    answeredAt: minutesAgo(4),
    delivery: { outcome: 'stuck', at: minutesAgo(1) },
  },
};

export const agentNotRunning: GalleryGate = {
  mr: MRS.highlights,
  gate: {
    ...doctorEscalation.gate,
    gateId: 'gallery-agent-not-running',
    status: 'answered',
    answers: { action: 'keep-main' },
    answeredBy: 'pane',
    answeredAt: minutesAgo(30),
    execution: 'unassigned',
  },
};

export const answeredElsewhere: GalleryGate = {
  gate: { ...ship.gate, gateId: 'gallery-answered-elsewhere' },
};

// --- Queue recap ------------------------------------------------------------

const decidedRow = (
  entry: GalleryGate,
  gateId: string,
  answers: GateAnswers | undefined,
  answeredBy: string
): GalleryGate => ({
  ...entry,
  gate: {
    ...entry.gate,
    gateId,
    status: 'answered',
    ...(answers ? { answers } : {}),
    answeredBy,
  },
});

export const queueRecap: GalleryGate[] = [
  decidedRow(
    respondPlanProse,
    'recap-respond-plan',
    {
      'thread-1': `fix:${SENSOR_THREADS.t1}`,
      'thread-2': `reply:${SENSOR_THREADS.t2}`,
      'code-changes': 'approve',
    },
    'board'
  ),
  decidedRow(
    respondPostLongReplies,
    'recap-respond-post',
    {
      'thread-1': [`post:${FOLD_THREADS.t1}`],
      'thread-2': [`post:${FOLD_THREADS.t2}`],
    },
    'board'
  ),
  decidedRow(
    reviewPostProseBySeverity,
    'recap-review-post',
    {
      'findings-1': ['f1', 'f2', 'f3'],
      'findings-2': ['f4', 'f5'],
      outcome: 'comment',
    },
    'board'
  ),
  decidedRow(ship, 'recap-ship', shipWinningAnswer, 'shepherd'),
  decidedRow(
    herdQuestion,
    'recap-herd-question',
    {
      q1: 'Report now on the lookup evidence and the drafted text; skip posting',
    },
    'shepherd'
  ),
  decidedRow(validation, 'recap-validation', { validation: 'yes' }, 'console'),
  decidedRow(reviewPostVerdictOnly, 'recap-lagging', undefined, 'board'),
];
