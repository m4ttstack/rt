the agent-coordination release. rt grows a daemon gate facility that lets any surface ask a question and any surface answer it, a full herd orchestration layer for running fleets of Claude workers, an MCP server that exposes the estate's verbs as typed tools, and the finished Go picker that retires fzf outright. Underneath: encrypted off-machine state backup, a background pane server, mac app lifecycle fixes, a headless git core library, and a VM harness that now proves team joins, updates, and the whole kitchen sink on clean guests.

**Upgrading from 2.8.0:** v2.8.0 does not install on a fresh Mac. Required checklist rows could never clear: a probe budget too short for the tool it measured, a backup row alarming inside the daemon's own push-delay window, a forge row demanding a confirmation the Accounts row had already handled, and a switchboard row demanding a credential no input could satisfy. Two of these hard-blocked Install. This release fixes all four and the fresh-Mac install path.

### Gates

- a daemon gate registry (gates.db): `rt gate open|answer|wait|list|park|close|subscribe`, CAS answers, same-kind supersede, TTL escalation, retention sweeps
- gates carry labeled options, context, origin, and an owner; owner-scoped subscriptions route herd questions to the shepherd and keep them out of human notifications
- `gate:ask` owns the ceremony server-side: subject resolved from the caller's session (run, then agent record), one shared presentation rule (form iff an injectable pane, a nudge target, and every question at or under 4 options), context capped, supersede inherited from gate:open
- answer-shape validation is canonical in rt-client (gate-answers, gate-presentation); the daemon and every UI consume the same module
- strict option membership at the answer verb closes the silent-inversion class; a surface is never notified of the answer it recorded itself
- remotely answered form gates get doorbell-then-Escape injection, with pane refs resolved live by session and worktree rather than a stale paneId
- the gate-fork PreToolUse hook denies improvised AskUserQuestion forks in subject-stamped panes; herd spawns stamp the subject, and the app bundle ships the hook script
- notification bridge: settings-driven rules with subjectPrefix filters, pane-focus click routing, and a {question} template
- `rt gate ask`: a CLI verb that opens a gate with the full gate:ask ceremony from the terminal (#276)
- canonical option shape (value + label) normalized at the registry; gate:ask passes meta and origin through (#279)
- options carry descriptions and per-question context (#299)
- a recommended flag on options; label normalization leaves path-like and id-like labels untouched, and a suffix guard prevents double-appending the recommended marker (#281)
- answered-gate pushes are consumed when the nudged session reads the answer (gate:wait / herd:answer); missed answers are re-sent by a periodic sweep with bounded attempts (#280)
- gate:ask resolves a stale-run subject by walking a ladder (run, then agent record), carries origin.worktree, and refuses bare-context human-owned gates that would produce an unanswerable question (milestone and pane-attention kinds exempt) (#295)
- gate-fork hook allows the worktree's own open run-gate, so a worker's own pipeline questions are not denied (#290)


### Herding

- `rt herd start|spawn|status|gates|ask|milestone|answer|report|close|wrap-up|resume|list`: one verb spawns the worktree, pane, brief, chat sign-in, and trust accept; the daemon records job state as a side effect of every verb
- worker questions ride the gate registry and push to the shepherd; reports and lifecycle land in the herd's chat room; a fresh session recovers everything with `rt herd resume`
- hidden mode runs workers on a shared background herdr server with claims; `rt herd attend` brings one pane in front of the human
- `rt herd brief` assembles job briefs mechanically from the shepherd skill's template and strategy bodies, with leftover-marker detection
- idle-stall notices, dead-pane nudge retries, respawn into the same tree with the stored brief, and disposal guarded by running-run checks
- `rt accounts` lists credential health; a daemon sweep probes github/gitlab token expiry and notifies on transitions
- a daemon-driven watchdog detects wedged workers (no progress, no open gate, no activity) and pokes them by injecting a line into the worker's pane over the herdr socket (#301)
- watchdog follow-up wave: trust unification across spawn and resume, 12-item sweep of lifecycle edge cases (#304)
- watchdog open-gate exemption (a worker waiting on a gate is not wedged), and mid-run trust accept off by default so workers do not auto-accept trust dialogs the shepherd has not seen (#305)
- spawn folder-trust robustness: the spawned pane's folder-trust dialog is accepted after launch; dead worker sessions detected by session liveness, not pane existence (#296)

### MCP

- `rt mcp serve`: a stdio MCP server (server name mattstack) exposing gates, chat, herd, and MR threads as typed tools over the daemon: gate_answer, gate_list, chat_post, chat_dm, chat_ack, chat_claim, chat_release, mr_reply_thread, herd_gates, herd_ask, herd_answer, herd_report
- chat identity resolves from the caller's Claude session id; the server is lazy-loaded so rt startup stays flat
- wave-2 tools: gate_ask, mr_comment_inline, mr_map, and cursor-based gate_list for paginated queries (#277)
- heal-pair repo lookup resolves a repo by name against the repos index; the MCP layer replaces daemon error codes with remediation prose so callers get actionable messages (#297)
- the chat skill trims onto the MCP chat tools so agents using the MCP server get chat without the CLI (#278)

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

### The mac app

- the tray app stays a Dock app for the whole run; the Dock icon is never hidden while the process is alive (#287)
- a Window menu so cmd-W closes the window instead of doing nothing (#286)
- a quit with no window on screen is a real quit, not a silent background linger (#283)
- the app catalog is warmed at launch so a browser handoff arriving before the window has opened does not blow the caller's timeout and fall back to the browser (#282)
- TrayState and its writers pinned to the main actor, fixing an off-main-thread SwiftUI publish during the 10s status polling that aborted the app (#292)
- terminal focus raise for daemon-hosted panes: when a pane needs attention, the terminal window comes forward (#238)

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
- team setup asks where your repos should live instead of assuming a folder (#265)
- editor opening via OS handoff for non-web schemes (vscode://, cursor://) and a suite-wide default editor setting (#294)
- the sdm probe trusts the status table rather than matching an email substring (#302)
- the baseline allow list includes the mattstack MCP server under its registered namespace (#285)

### Daemon and runs

- an executor reconciler relaunches gone executors on answered gates, verifies delivery, and raises attention gates instead of losing work
- run DB write verbs resolve the caller's run automatically (env, session, worktree); dispose refuses on a running run
- daemon lifecycle gates restart races and names who asked; the team supervisor degrades instead of taking the daemon down
- a read-only git core library (`packages/git-core`): a typed facade exposing snapshot, diff, branch, tag, log, stash, and fetch-state queries (#303)

### Chat

- claim/release: test-and-set on who answers a room question; rooms default to wake-on-mention with the human's post waking the room
- handles pin to their herdr pane, `chat:mark --upto` advances the read cursor, and outbound activity touches presence

### Proving it

- the VM harness drives create, join, update, and kitchen-sink scenarios on golden macOS 26 guests: SecurityAgent prompts answered by content, System Settings toggles walked by name, the Sparkle update leg driven through its real install path, encrypted backups asserted with no Homebrew in the guest
- the release workflow rehearses via workflow_dispatch and check-bundle asserts the sealed bundle's full contract, gate-fork hook included

**Full Changelog**: https://github.com/m4ttstack/rt/compare/v2.8.0...v2.9.0
