# MCP MR write tools, phase 1b (GitLab)

Status: design approved by Matt 2026-09-25 (tool surface, rt-only squash,
`mrUrl`, restricted uploads, acceptance run after this ships). Extends
`2026-09-25-mcp-mr-write-tools-design.md` (phase 1, RT-315, rt#472).

## Problem

Phase 1 gave agents MCP tools for the MR writes the mattstack engines make,
so those writes skip the auto-mode classifier. Two gaps remain.

1. **Writes with no tool.** Team packs' domain flows still shell out to
   `glab` for writes phase 1 did not cover: editing an MR's title or
   description, uploading an evidence image or video, and setting squash
   and labels at creation (a team MR flow can require squash on and a set of
   labels applied when the MR opens). Each is a `glab` write the classifier
   judges, so a board-approved flow still stalls on it.
2. **Agents build repo identities by hand.** Every tool takes `repoName` as
   the serialized identity (`remote:gitlab.com%2Facme%2Facme-dev`). A pane
   usually holds only an MR URL or its own worktree path, so the agent
   composes the identity string itself. That breaks under
   `rt.repoIdentityOverrides` and for forks, and rt's own identity docs say
   never to derive one.

## Goal

Every MR write a team flow makes on GitLab has an MCP tool, and every tool
accepts the target the agent already holds: an MR URL, its worktree path,
or a repo label.

## Non-goals

- GitHub (RT-321).
- A merge tool (still off the server; see phase 1 Guardrails).
- Changing glance. Squash goes through glance's public `restRequest`; if
  glance later types squash, rt moves to it.
- Editing any team pack's fills (separate follow-up once this ships).

## Target resolution (all MR write tools)

Every MR write tool (`mr_reply_thread`, `mr_comment_inline`, `mr_comment`,
`mr_resolve_thread`, `mr_approve`, `mr_ready`, `mr_retry`, `mr_rebase`,
`mr_create`, and the new `mr_update`, `mr_upload`) resolves its target in
the MCP layer before calling the daemon. `mr_map` is unchanged.

- `repoName` accepts what `--repo` accepts, through the one resolver that
  already exists (`tryResolveRepoArg`, `lib/repo-arg.ts`): a serialized
  identity, an absolute path to a local checkout or worktree, or a repo
  label that matches exactly one registered repo. Ambiguous or unknown
  input is refused with the resolver's matches, never guessed.
- `mrUrl` is an alternative for tools that act on an existing MR: an
  `https://<host>/<group>[/<subgroup>...]/<project>/-/merge_requests/<iid>`
  URL (a trailing `#...`, `?...` or `/diffs` suffix is ignored). The host
  and project path map to an identity through `identityFromRemote` (so
  identity overrides apply), and the identity must be a repo rt has
  registered; otherwise the tool refuses. `iid` comes from the URL.
- Given both `repoName`/`iid` and `mrUrl`, they must resolve to the same
  identity and iid, else the tool refuses. MR-level tools need an `iid`
  from one of them; project-level tools (`mr_create`, `mr_upload`) need a
  repo from `repoName` or `mrUrl`.
- The daemon verbs keep taking the serialized identity only; resolution is
  a client-side concern, like `--repo` on the CLI.

## New and changed tools

| Tool | Change | Daemon verb |
|---|---|---|
| `mr_create` | gains `labels?: string[]` and `squash?: boolean` | `mr:create` (extended) |
| `mr_update` | new: `title?`, `description?`, `addLabels?`, `removeLabels?`, `squash?`; at least one required | `mr:update` (new) |
| `mr_upload` | new: `path` (one local file); returns `{url, markdown}` | `mr:upload` (new) |

### `mr:create` extension

- `labels` pass through glance's `CreatePullRequestInput.labels`.
- `squash`, when given, is set right after the create with
  `provider.restRequest("PUT", "/projects/<encoded path>/merge_requests/<iid>", { squash })`.
- A create that landed is never reported as `ok:false` (phase 1 rule). If
  the squash write fails, the result is still `ok` with
  `squashApplied: false` and `squashError`, so the caller sets it with
  `mr_update` instead of creating again. The read-back-failure path
  (`ReadBackFailedError` with `writeApplied`) still attempts the squash
  write with the iid it has.

### `mr:update`

- `title` and `description` go through glance `updatePullRequest`, which
  keeps draft state intact across a title change (GitLab stores draft in
  the title).
- `addLabels`, `removeLabels` and `squash` go in one
  `restRequest("PUT", .../merge_requests/<iid>, { add_labels, remove_labels, squash })`.
  Add and remove, never replace-the-set, so labels CI or teammates set
  survive.
- Order: glance update first, then the REST write. Both are idempotent, so
  on a partial failure the result is `ok:false` with an error that names
  what landed and what did not; retrying is safe.
- Refused before any network call: no field given; a blank title; a label
  that is blank or contains a comma (GitLab's label params are
  comma-separated); a non-boolean `squash`.

### `mr:upload`

Uploads one file to the target project (GitLab `POST /projects/:id/uploads`,
multipart). Works before an MR exists. Returns `{url, markdown}` from
GitLab's response (the markdown renders in that project's MRs).

Every mattstack MCP tool runs with no permission check, so an unrestricted
upload would let an agent send any local file to a forge unprompted. The
daemon refuses unless all of these hold:

- `path` is absolute; its `realpath` (symlinks resolved first) is a regular
  file.
- The realpath sits under an allowed root:
  - any worktree rt knows for the target repo;
  - the Claude Code temp root for this user (`/private/tmp/claude-<uid>/`
    and its `/tmp` alias), where session scratchpads live;
  - each directory in the new setting `rt.mcp.uploadRoots` (machine scope,
    absolute paths; see Settings).
- The extension is one of png, jpg, jpeg, gif, webp, mp4, mov, webm AND the
  file's leading bytes match that type's signature.
- The size is at most 50 MB.

The multipart POST is daemon code (glance has no multipart support): it
uses the same GitLab token and base URL `getRepoContext` provides and
reports through `providerRequestHook` like other provider calls.

## Settings

`rt.mcp.uploadRoots`: string array, machine scope, default empty. Each entry
is an absolute directory `mr_upload` may read from, in addition to the
built-in roots. Registered per `docs/settings-architecture.md` (registry
entry, scope, docs row). Non-absolute entries are ignored with a warning.

## Timeouts and retries

- `mr_update` uses `MR_WRITE_TIMEOUT_MS` (30s) and the landing hint on a
  timeout ("check the MR before retrying").
- `mr_upload` uses 120s. A timed-out upload may have landed; retrying only
  leaves an unused upload in the project, so its hint says retrying is safe.
- No tool retries on its own.

## Guardrails

- String booleans, non-positive ids, and blank strings are refused before
  the daemon, as in phase 1.
- `mr_upload` never follows a path outside the allowed roots, never reads a
  file whose signature does not match its extension, and never uploads a
  directory.
- Descriptions say "GitLab only".

## Testing and verification

- Unit: target resolution (identity, path, label, ambiguous label, unknown,
  `mrUrl` with subgroups and suffixes, override applied, unregistered repo,
  disagreement between `repoName` and `mrUrl`); each new and changed verb
  with the seams phase 1 uses; upload refusals (relative path, symlink
  escape, outside roots, bad extension, extension/signature mismatch, over
  cap, directory, missing file); `rt.mcp.uploadRoots` read at call time.
- The MCP roster and e2e `EXPECTED_TOOL_NAMES` gain `mr_update` and
  `mr_upload`.
- Pre-merge smoke against the harness GitLab project (never an employer
  project): create with labels and squash, update title/labels, upload a
  png from the scratchpad and reference it in a note; confirm each by API
  read-back.
- Board acceptance run for all of RT-315 after this deploys (harness
  project registered with rt, board review with the post gate answered on
  the board).

## Rollout

Same as phase 1: PR with CodeRabbit and green CI, merge on Matt's go, dev
deploy (pull main checkout, rebuild rt-client, daemon restart). Team pack
fills switch to the new tools in their own follow-up.
