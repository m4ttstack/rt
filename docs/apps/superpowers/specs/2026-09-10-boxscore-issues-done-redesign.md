# Boxscore "Issues done" redesign: merge-anchored, attachment-linked

Date: 2026-09-10
Status: approved design, pending spec review

## Problem

`issuesCompleted` ("Issues done") today counts a Linear ticket for a user
when (a) any of the user's MRs *mentions* the identifier anywhere in title,
source branch, or description, (b) the ticket's current state is in
`linearDoneStates`, and (c) any linked MR was *updated* in the window. There
is no notion of when the ticket was closed and no distinction between an
implementing MR and an incidental mention.

Verified failure (live store): a ticket was credited to the author of a
cleanup MR that merely mentions it in prose; that ticket's real implementing
MR merged a year earlier, authored by someone else. Cleanup MRs link up to
27 tickets each. A 2026-09-10 spike over all 493 stored identifiers measured the
inflation at roughly 20-25% per person (90d: 124 -> 102, 96 -> 74 for the
top two rows), with the stricter rules a strict subset of today's counts.

Two data findings drive the design:

- Linear `completedAt` is unreliable here: 142/330 done tickets share a
  completion second with 3+ others (bulk state sweeps), and 129/211 sit more
  than 7 days from their MR's merge. It must not anchor anything.
- Linear `attachments` (sourceType `gitlab`) reliably identify the
  implementing MR(s): 321/330 done tickets have one, and the attachment set
  and a closing-grade text scan agree exactly on 276 of the 294 tickets
  where both exist, never disjointly.

## Design

### Link grades

Every issue-to-MR link carries a grade, computed at refresh:

- **attachment**: the MR appears among the issue's Linear `gitlab`
  attachments.
- **closing**: the MR references the identifier in its title or source
  branch, or in its description within a closing-keyword phrase
  (`close/closes/closed/closing`, `fix/fixes/fixed/fixing`,
  `resolve/resolves/resolved/resolving`,
  `implement/implements/implemented/implementing`, keyword and identifier at
  most 40 non-newline characters apart, markdown links allowed). Revert MRs
  (title starting with `Revert`) never earn this grade.
- **mention**: anything else. Evidence-only; never counts, never credits.

A link that earns several grades takes the strongest (attachment > closing
> mention). Discovery is unchanged: identifiers enter the dataset by
appearing in eligible MR text; attachments are fetched during verification,
so a mention-only discovery can still surface an issue whose attachments
point at its real MRs.

### Qualifying MRs

The issue's *qualifying merged MRs* are its merged attachment-grade MRs;
when the issue has no MR-shaped gitlab attachment at all (attachments to
issues or commits leave the fallback open), its merged closing-grade
MRs (spike: the fallback recovers 2 tickets; 9 lack attachments). An
attachment pointing at an MR the store has never scanned resolves to
nothing, deliberately: a ticket implemented before the data horizon must
not count in a recent window, and its unresolved MR attachment still
suppresses the text fallback.

### Counting rule

An issue counts toward `issuesCompleted` in window W for user U iff:

1. its identifier belongs to any Linear team (the `linearTeam` setting no
   longer gates counting),
2. its current state is in `linearDoneStates`, or its type is `completed`
   or `canceled` (a name absent from `linearDoneStates` still counts
   through this type fallback, since that list comes from one team's
   workflow and must not exclude another team's),
3. it has at least one qualifying merged MR and its `closedAt` lies in W,
4. U is its `creditedUser`.

**closedAt** = the latest `mergedAt` among qualifying merged MRs visible to
the refresh. A refresh that can no longer see any qualifying merged MR (the
MRs aged out of the scan window) keeps the stored `closedAt`,
`creditedUser`, and `linkedMrs` instead of clearing them; a refresh that
sees at least one recomputes all three. A late-attached follow-up MR can
move `closedAt` forward; the spike found multi-MR tickets rare (14/330,
median first-to-last gap 4.8 days, max 31), so this is accepted.

**creditedUser** = the author of the earliest-merged qualifying MR,
preferring roster authors, with the existing deterministic tiebreak
(mergedAt, then projectPath, then iid). The current unmerged-MR credit
fallback is dropped: an issue with no qualifying merged MR has null credit
and cannot count.

### Windowing

`buildFetchResult` returns all stored issues (the `linearIssuesForMrKeys`
selection is removed); the cohort layer filters by team, done state,
`closedAt` in window, and credited user. Trend windows stop double-counting
because `closedAt` places each issue in exactly one window.

### MRs merged

`authoredMerged` drops the `hasTeamTicket` gate: every MR the user authored
that merged in the window counts, whether or not it references a team
ticket. This also widens the metrics derived from `authoredMerged`
(additions, deletions, size health, revert rate, merge streaks), which is
intended: their descriptions already claim "merged MRs the user authored".
`MetricFilters.hasTeamTicket` becomes dead and is removed.

## Implementation shape

- `linear/ticket.ts`: add the closing-grade classifier (title / branch /
  keyword forms, revert exclusion) beside the existing extraction helpers.
- `linear/raw-types.ts` + `linear/fetch.ts`: verify query gains
  `attachments(first: 50) { nodes { url sourceType } }`; chunk size drops
  from 100 to 25 (the spike ran 20-issue chunks with attachments without a
  single batch failure; 100 risks complexity limits). Attachment URLs
  resolve to `(projectPath, iid)` by parsing `/-/merge_requests/`.
  `creditedAuthor` moves to qualifying-merged-MR pools. MRs referenced only
  by attachments (not present in the scanned source set) are looked up in
  the store by key for merge state and dates.
- `store/model.ts`: `NormLinearIssue.assignedUser` renamed `creditedUser`;
  `linkedMrs` entries gain `via: 'attachment' | 'closing' | 'mention'`;
  new `closedAt: string | null`. Old cache envelopes already fall back via
  `fetched.linearIssues ?? []`; rows missing the new fields are treated as
  `closedAt: null` (they repopulate on the next refresh).
- `store/index.ts`: `upsertLinearIssues` preserves stored `closedAt`,
  `creditedUser`, and `linkedMrs` when the incoming row has no qualifying
  merged MRs; `linearIssuesForMrKeys` is replaced by an all-rows read.
- `metrics/cohorts.ts`: issue cohort filters on `closedAt` in window and
  `creditedUser`; `authoredMerged` loses `hasTeamTicket`.
- `metrics/evidence.ts`: issues table gains a Closed column; summary keeps
  the team/state exclusion counts and appends the count of team+state
  survivors excluded because `closedAt` is null or outside the window.
- `shared/metrics.ts`: rewrite the `issuesCompleted` description to match
  reality (merge-anchored, attachment-linked, credited to the MR author);
  delete the phantom "completed within 90 days of being filed" claim.

## Testing

- Classifier: title/branch/keyword/mention grades, `Closes [ACME-1](url)`
  markdown form, keyword distance bound, revert exclusion, `ACME_123` branch
  form, no prefix-number false matches (ACME-302 vs ACME-3027).
- Credit: earliest-merged roster preference over qualifying sets; null
  credit with nothing merged.
- Store: sticky upsert preserves the three fields only when the incoming
  row is empty of qualifying merged MRs.
- Cohorts: closedAt windowing (in, before, after), team and state gates
  unchanged, no double count across current/prior windows.
- MRs merged: ungated count includes a no-ticket MR.
- Parity: evidence rows continue to match snapshot counts
  (test/parity.test.ts).

## Out of scope

- Crediting by Linear assignee (needs a displayName-to-GitLab map; spike
  showed it lands within a few tickets of MR-author credit).
- Backfilling closure history beyond the store's scan horizon.
- UI changes beyond the evidence table column.
