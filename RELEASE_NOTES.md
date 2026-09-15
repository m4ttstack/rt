the agent-coordination release. rt grows a daemon gate facility that lets any surface ask a question and any surface answer it, a full herd orchestration layer for running fleets of Claude workers, an MCP server that exposes the estate's verbs as typed tools, and the finished Go picker that retires fzf outright. Underneath: encrypted off-machine state backup, a background pane server, and a VM harness that now proves team joins, updates, and the whole kitchen sink on clean guests.

### Gates

- a daemon gate registry (gates.db): `rt gate open|answer|wait|list|park|close|subscribe`, CAS answers, same-kind supersede, TTL escalation, retention sweeps
- gates carry labeled options, context, origin, and an owner; owner-scoped subscriptions route herd questions to the shepherd and keep them out of human notifications
- `gate:ask` owns the ceremony server-side: subject resolved from the caller's session (run, then agent record), one shared presentation rule (form iff an injectable pane, a nudge target, and every question at or under 4 options), context capped, supersede inherited from gate:open
- answer-shape validation is canonical in rt-client (gate-answers, gate-presentation); the daemon and every UI consume the same module
- strict option membership at the answer verb closes the silent-inversion class; a surface is never notified of the answer it recorded itself
- remotely answered form gates get doorbell-then-Escape injection, with pane refs resolved live by session and worktree rather than a stale paneId
- the gate-fork PreToolUse hook denies improvised AskUserQuestion forks in subject-stamped panes; herd spawns stamp the subject, and the app bundle ships the hook script
- notification bridge: settings-driven rules with subjectPrefix filters, pane-focus click routing, and a {question} template

### Herding

- `rt herd start|spawn|status|gates|ask|milestone|answer|report|close|wrap-up|resume|list`: one verb spawns the worktree, pane, brief, chat sign-in, and trust accept; the daemon records job state as a side effect of every verb
- worker questions ride the gate registry and push to the shepherd; reports and lifecycle land in the herd's chat room; a fresh session recovers everything with `rt herd resume`
- hidden mode runs workers on a shared background herdr server with claims; `rt herd attend` brings one pane in front of the human
- `rt herd brief` assembles job briefs mechanically from the shepherd skill's template and strategy bodies, with leftover-marker detection
- idle-stall notices, dead-pane nudge retries, respawn into the same tree with the stored brief, and disposal guarded by running-run checks
- `rt accounts` lists credential health; a daemon sweep probes github/gitlab token expiry and notifies on transitions

### MCP

- `rt mcp serve`: a stdio MCP server (server name mattstack) exposing gates, chat, herd, and MR threads as typed tools over the daemon: gate_answer, gate_list, chat_post, chat_dm, chat_ack, chat_claim, chat_release, mr_reply_thread, herd_gates, herd_ask, herd_answer, herd_report
- chat identity resolves from the caller's Claude session id; the server is lazy-loaded so rt startup stays flat

### MR plumbing

- `mr:comment-inline`: positioned DiffNote comments with diff_refs fetched server-side, the created note's type verified from the creation response, and one delete-and-repost repair on silent degrade (glance 0.25.0)
- `rt mr map`: your open MRs joined to the local worktrees holding their branches by exact branch equality
- stale-claim sweeps honor open MRs and measured activity; worktree auto-dispose reads GitHub PR state too

### The picker

- the fzf cutover completes: every picker is the one-shot Go `rt-ui pick` verb, fzf's matcher kept only as a pinned ranking library; fzf.ts and the fzf-driving e2e suites are deleted
- multi-select with marks and a selected panel, an action registry driving the keybar and ctrl-k menu, modal overlays, right-click menus, held-modifier chrome, match highlighting, grouped rows, in-place detail expansion
- cd, commit, run, navigation, skills, worktree, and arg-collector pickers all migrate; breadcrumbs and a shared aborted line on every cancel path
- navigation rebuilt on the events model (descend-in-place, sort modal, watcher); run picker gets grouped script rows and a tab queue

### Background panes

- a persistent bg service with a claims store: `rt agent --bg` launches on the background server, `rt bg ensure|status|release|stop` manage it, and stop is claim-gated so nothing owned dies silently
- `rt pane send`: inject a line into any pane, `self` targets the caller, and `--then` queues a continuation the daemon types after the target's turn ends
- runner's herdr mode acquires the bg server through the daemon with a board claim; focus attends via pane:focus

### Teams

- invites deliver as one join link (code, deep link, and page url share an extractor); the app accepts a paste and preflights the joiner's forge auth
- invite mints a forge grant; members can be pull-only, and every team write path (publish, members, secrets, snapshot push) refuses honestly on a pull-only clone
- a team-clone snapshot engine pulls, converges the Claude plugin pack cache against what the team serves, and never resolves conflicts silently
- gh and glab run from the app bundle; clone, publish, and invite carry the token rt holds instead of hoping the shell has one

### State backup

- encrypted, compressed, off-machine backup of suite state: VACUUM or tar, zstd, age to multiple recipients, Git LFS in the home repo; restore decrypts, integrity-checks, and places with holder-process guards
- age, zstd, and git-lfs ship in the bundle and resolve from it first; a daemon sweep runs the cycle every 4 hours

### Setup and the app

- finish-gated checklist rows with waive/unwaive; the Fast Browser extension gates Finish unless waived, and Done exposes the manual steps Install cannot take
- a privileged proxy helper installs with pinned payloads, root-owned staging, CA trust it owns and can untrust, and complete rollback
- Install seeds a baseline Claude Code permissions allow list, writes a Linear MCP entry when a key exists, and distinguishes unowned PATH precedence from missing
- four checklist rows that cried wolf are fixed; credential expiry shows on the checklist

### Daemon and runs

- an executor reconciler relaunches gone executors on answered gates, verifies delivery, and raises attention gates instead of losing work
- run DB write verbs resolve the caller's run automatically (env, session, worktree); dispose refuses on a running run
- daemon lifecycle gates restart races and names who asked; the team supervisor degrades instead of taking the daemon down

### Chat

- claim/release: test-and-set on who answers a room question; rooms default to wake-on-mention with the human's post waking the room
- handles pin to their herdr pane, `chat:mark --upto` advances the read cursor, and outbound activity touches presence

### Proving it

- the VM harness drives create, join, update, and kitchen-sink scenarios on golden macOS 26 guests: SecurityAgent prompts answered by content, System Settings toggles walked by name, the Sparkle update leg driven through its real install path, encrypted backups asserted with no Homebrew in the guest
- the release workflow rehearses via workflow_dispatch and check-bundle asserts the sealed bundle's full contract, gate-fork hook included

**Full Changelog**: https://github.com/m4ttstack/rt/compare/v2.8.0...v2.9.0
