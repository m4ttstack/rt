# Pack authoring: `rt skills init` plus two mattstack skills

## Goal

A team's author, starting from a repo with no pack, ends one session with an
installed pack whose `/<pack>:work` runs the pipeline. Domain rules are
optional: offered during creation when the team already has them written
down, added later otherwise, always in the author's own words. No
placeholder prose ever ships.

Audience: other teams at the same company first (GitLab, shared rt and
mattstack install). Nothing here is specific to any one team, so the skills
pass the mattstack purity gate.

## Locked decisions

- **One pack per zone, named after the zone's namespace.** `merge-manifests`
  folds every pack in a zone into every project that zone declares, so a
  second team's pack in an existing zone would inherit (or collide with) the
  first pack's bindings; and rt's default-manifest lookup keys on the pack
  name while the merge labels fragments `<namespace>@<zone>`, so a pack
  named anything else loses every flagless `rt skills` verb. Both go away
  when the pack is the zone's namespace. Stacking packs in one zone is
  something the merge can do but init never creates.
- **Topology by detection.** A zone already declaring the repo wins (its
  pack, when present, is the repo's pack: `pack-exists`). Otherwise a zone
  on the repo's forge host that has no pack yet. Otherwise a new zone is
  scaffolded. Zones that already carry a pack are skipped, never joined.
- **`rt skills bind` writes the binding into the team pack's fragment.**
  Today it writes only the generated per-repo manifest, which the next
  materialize rewrites and teammates never see. For a team-shaped pack it
  also applies the same `bindings.<engine>.<slot>` edit to
  `<pack>/pack/skills.jsonc`; a standalone pack's fragment is its manifest
  and is written once.
- **Floor is zero fills.** Every domain slot is optional and an unbound slot
  renders as nothing, so a roster plus a bindings fragment is a working
  pack. Generic provision and ship stages carry explicit unbound fallbacks.
- **No `mattstack:work`.** The generic pipeline is the team's own zero-fill
  pack, never a second `work` verb in the `mattstack:` namespace.
- **Deterministic scaffolding lives in rt** (`rt skills init`); judgment
  (interview, writing fills, verification) lives in two skills.
- **Roster on scaffold is `work` only.** Its eight stages ride along as
  internal targets. `ship`, `review`, `watch-ci` doors are added later by
  editing `pack/stubs.jsonc`.
- **Every `context` skill and every fill goes through
  `superpowers:writing-skills`** (RED baseline first, then the skill).
  Declared as a REQUIRED SUB-SKILL in both pack skills.
- **Two skills, one interview.** `creating-a-pack` scaffolds and proves;
  `extending-a-pack` owns the interview and is what `creating-a-pack` hands
  each already-written rule to. `editing-skills` stays the publish tail.

## Out of scope (follow-ups, each its own ticket)

- `rt setup pack`'s "stages resolve" check reads `pipelines[type].stages`
  on what is an array, and `isBound` expects a string where bindings are
  objects. It never blocks and never validates.
- `merge-manifests` reading `settings.team.jsonc` so the `team.jsonc` shim
  can go. Until then `init` writes the shim.
- GitHub-hosted teams. The shim only knows `gitlabHost`.
- A roster-editing verb (`rt skills roster add`). Editing `stubs.jsonc` by
  hand is fine at this scale.

## What `init` produces

```
<zone>/mattstack/packs/<pack>/
  .claude-plugin/plugin.json     name, version 0.1.0, description, skills: "./skills/"
  PACK.md                        short map; names the two skills for next steps
  pack/surface.jsonc             { "public": ["work"] }
  pack/stubs.jsonc               { "verbs": { "work": { "engine": "work", "description": <seeded> } } }
  pack/skills.jsonc              version 1; skills.enabled = [mattstack:work, mattstack:model-tiering];
                                 pipelines.feature = the eight mattstack stages;
                                 bindings: mattstack:work.tiering -> mattstack:model-tiering,
                                 mattstack:stage-watch-ci.forge -> mattstack:ci-forge-gitlab
  skills/work/SKILL.md           compiled
  attachments/stage-*/SKILL.md   compiled, eight of them
```

Zone edits: `mattstack/team.jsonc` gains the repo (created with `gitlabHost`
plus `projects` when absent), `.claude-plugin/marketplace.json` gains a
plugins entry `{ name, source: "./mattstack/packs/<pack>", description }`.

The `work` description is seeded from the engine's own frontmatter
`description` in the installed mattstack cache, so the roster cannot go
stale the way a copied template does. It is a placeholder: `PACK.md` and
`creating-a-pack` both say to rewrite it in the team's words.

## `rt skills init`

New leaf under `skills` in `lib/command-tree-def.ts`, module
`commands/skills-init.ts` (registered in `lib/module-registry.ts`). No
required positional, so no `omitBehavior`.

Inputs:

| flag | meaning | default |
| --- | --- | --- |
| `--repo <path>` | a git checkout with a remote | cwd |
| `--zone <slug>` | which zone hosts the pack when several match | detected |
| `--json` | envelope output | off |

The pack is named after the zone's `namespace` (from its
`mattstack.jsonc`); there is no `--pack`.

Steps, in order. Every refusal fires before anything is written.

1. **Resolve the repo.** `git remote get-url origin` (first remote as a
   fallback). Refuse `not-a-repo`, `no-remote`.
2. **Resolve the zone.** Zones are the dirs under `~/.mattstack/teams/*/`
   whose `mattstack.jsonc` has `role: team`; each has a namespace, a forge
   host (from `team.jsonc` `gitlabHost`, else `settings.team.jsonc`
   `mattstack.integrations.forge.host`, else none yet), declared projects,
   and whether `mattstack/packs/` already holds a pack. A zone declaring
   the repo path wins outright. Otherwise candidates are zones with no
   pack whose host matches the remote host or is unset. Several: refuse
   `zone-ambiguous`, listing them, remedy `--zone`. None: in a TTY, prompt
   for team name and remote and call the existing `createTeam`; without a
   TTY refuse `zone-missing`, remedy `rt team create`. `--zone <slug>`
   naming a zone on another host is `zone-mismatch`; naming one that
   already carries a pack is `zone-has-pack`.
3. **Refuse on an existing pack dir** (`pack-exists`: the declaring zone
   already has this repo's pack), on a missing mattstack plugin cache
   (`mattstack-missing`, engines unreadable), on no `claude` binary
   (`claude-missing`).
4. **Write** the pack files and the two zone edits above.
   `team.jsonc` and `marketplace.json` edits go through `jsonc-parser`
   edits, comments preserved, entries left alone when present.
5. **Register and materialize:** `rt repos register <repo>` (idempotent),
   then `merge-manifests.sh --repo <repo>` through the existing
   `materializeSkills`, so `~/.mattstack/repos/<slug>/skills.jsonc` exists.
   Its provenance header labels the fragment `<namespace>@<zone>`, which is
   what rt's default-manifest lookup matches against the pack name; the two
   agree because the pack is named after the namespace.
6. **Compile and check** through the existing `skillsCompile` and
   `skillsCheck` code paths (`--pack <pack>`). A failure here is reported
   verbatim and the files stay in place for the author to fix; exit 1.
7. **Install:** `claude plugin marketplace add <zone dir>` when the zone's
   marketplace name is not yet listed, then
   `claude plugin install <pack>@<marketplace>`. The author's own machine
   installs and enables; teammates get it through `rt setup`, which
   already installs every pack a zone's marketplace names and leaves
   enabling to them.
8. **Report.** `init` never commits: the zone is left dirty for the author
   to review; `creating-a-pack` commits and pushes at the end.

`--json` envelope:

```json
{
  "ok": true,
  "pack": { "name": "acme", "dir": "...", "zone": "acme", "marketplace": "acme" },
  "repo": { "slug": "gitlab.com-acme-api", "manifest": "~/.mattstack/repos/gitlab.com-acme-api/skills.jsonc" },
  "wrote": ["...pack/stubs.jsonc", "..."],
  "installed": { "plugin": "acme@acme", "version": "0.1.0" },
  "restartNeeded": true,
  "tryNext": "/acme:work <ticket>"
}
```

Refusals use the existing `UserActionableError` shape with the codes above,
exit 2.

Tests: `commands/__tests__/skills-init.test.ts` on a fixture HOME (the
`lib/skills/__tests__/helpers.ts` pattern), one case per refusal, one
asserting the exact file set and contents, one asserting the two zone edits
preserve comments and existing entries. Plus a compile of the generated pack
against the fixture engines, in the `compile-native.e2e.test.ts` style.

## `mattstack:creating-a-pack`

Location `plugin/skills/creating-a-pack/SKILL.md` (the `./plugin/skills`
root is already in the manifest's `skills` array).

Description (trigger-only, under 500 chars): use when a team wants the
mattstack pipeline on a repo that has no pack yet: "make a pack", "set up
/<team>:work", "we want the work pipeline on our repo", "onboard our team
to mattstack", or no pack of the team's is installed. Not for adding rules
to an existing pack.

Recipe (the output shape the skill states; form chosen after the RED
baseline, see Testing):

1. **Prerequisites, checked and stated, stop on any miss:** rt with a
   running daemon (`rt daemon status`), the mattstack plugin installed,
   `superpowers` installed, a GitLab remote on the repo.
2. **Run** `rt skills init --pack <name> --json` from the repo. Read the
   envelope; on a refusal, relay the remedy and stop.
3. **Restart.** `restartNeeded` in a herdr pane: `rt:herdr-inject`;
   otherwise tell the author to restart and what to type next.
4. **Prove it.** The author runs `/<pack>:work <small real ticket>` in the
   restarted session. The skill names what "works" looks like: a worktree
   provisioned, an APPROACH block, commits, an MR, a CI verdict.
5. **Ask once:** "Are any of your team's rules already written down
   (CONTRIBUTING, a review checklist, branch rules)?" Each yes is one round
   of `extending-a-pack`. No is a complete answer.
6. **Hand to `editing-skills`** to commit and push the zone so teammates
   receive the pack.

## `mattstack:extending-a-pack`

Location `plugin/skills/extending-a-pack/SKILL.md`, with `slots.md` beside
it carrying the triage table in full.

Description: use when a pack already exists and the team wants it to know
something new: "add a rule to our pack", "the pipeline should X on our
repo", "add a ship/review/watch-ci verb", "reword the work description", or
right after a generic stage missed a team rule.

Triage, one ask at a time:

| the ask is about | goes to | contract |
| --- | --- | --- |
| rules that hold even outside a pipeline (branch names, forbidden ops, where things live) | `skills/context`, hand-authored, public | none |
| getting a worktree, ticket lookup, branch shape | provision fill | `provision-domain@1` |
| what a plan must commit to, tiers, extra APPROACH lines | plan fill | `plan-domain@1` |
| checks for touched paths before implementation | gates fill | `gates-domain@1` |
| what counts as evidence, before/after capture | evidence fill | `evidence-domain@1` |
| own-branch review homework | self-review fill | `self-review-domain@1` |
| MR preflight, description shape, labels | ship fill (bound to `stage-ship`, and to `ship` once rostered) | `ship-domain@1` |
| CI job names, retry rules, triage | watch-ci fill (`stage-watch-ci`, and `watch-ci` once rostered) | `watch-ci-domain@1` |
| what reviewers check | criteria fill (`review`, `self-review`, `receive-review`) | `review-criteria@1` |
| how to answer review threads | reply-rules fill | `reply-rules@1` |
| fan-out rules for parallel agents | shepherdr domain fill | `shepherdr-domain@1` |
| a new door (`ship`, `review`, `watch-ci`, ...) | `pack/stubs.jsonc` entry plus `rt skills surface set <verb> --public` | none |
| wording of an existing verb | `pack/stubs.jsonc` description | none |

`rt skills composition --pack <pack>` is the live source for slot names and
contracts; the table is the reading aid. A bind targets a roster verb or a
stage, so a verb-level bind (`mattstack:ship`) needs the door rostered
first; the stage-level bind works either way. A `shepherdr` door is the one
verb with required slots: `tiering` and `strategy` must be bound (to
`mattstack:model-tiering` and `mattstack:execution-strategy`) before it
compiles; the domain fill stays optional.

Fill recipe, fixed shape, at `<pack>/attachments/<fill>/SKILL.md`:

```markdown
---
name: <fill>
description: "Use when mattstack:<engine> resolves its <slot> slot here; the pack manifest binds <contract> to this skill. Not for manual invocation."
disable-model-invocation: true
metadata:
  provides: "<contract>"
---
```

Writing the fill or `context`: REQUIRED SUB-SKILL `superpowers:writing-skills`.
RED runs in the author's own repo, in a worktree: run the generic stage or
verb on a small real task without the rule, record verbatim where it missed,
write the fill, run again. Then, in order: `rt skills bind <stage> <slot>
<pack>:<fill>` (validates `provides` against the slot's contract, writes the
binding into both the per-repo manifest and the pack's `pack/skills.jsonc`,
and recompiles), `tests/certify.sh <fill dir> --domain` from the
mattstack-skills checkout, `rt skills check --pack <pack>`, hand to
`editing-skills`. The fragment write is what reaches teammates; the
per-repo manifest is regenerated on every materialize.

## Retirements

- Delete `templates/domain-pack` in mattstack-skills. It predates the
  compiler (no `pack/`, no plugin manifest, tells the author to install a
  repo-local `skills.jsonc` the compiler never reads).
- Rewrite the README's Configuration section to name `creating-a-pack` and
  `extending-a-pack` and drop the template reference.

## Testing

1. **`rt skills init` unit tests** as listed above, plus a `bind` test
   proving a team pack's `pack/skills.jsonc` carries the binding after a
   bind and a standalone pack's manifest is written exactly once.
2. **Scratch end-to-end, before either skill is written.** Under
   `env -i HOME=<scratch> CLAUDE_CONFIG_DIR=<scratch>/.claude`, with the
   mattstack and superpowers plugins installed into that config and a
   scratch daemon started under that HOME only (its socket lives under the
   scratch HOME, so it never squats the live one; stopped afterwards). A
   fresh config dir has no credentials: the first `claude` call asks for a
   login, which the operator does by hand before anything else runs. The
   mattstack plugin installs from a scratch marketplace whose entry is a
   `file://` URL to the mattstack-skills worktree, so the GREEN runs later
   pick up the new skills with `claude plugin update` instead of a second
   plugin loaded by `--plugin-dir` beside the installed one.
   A throwaway GitLab project from the harness credentials, cloned into the
   scratch HOME. `rt team create` with a second throwaway project as the
   remote, then `rt skills init --pack scratch --repo <clone> --json`.
   Assert the file set, `rt skills check` clean, the plugin listed in the
   scratch config. Then a fresh Claude session under that environment runs
   `/scratch:work` on a toy task (add a README line) through provision,
   plan, implement, ship, and watch-ci on the throwaway project. This is
   the proof that the generic stages run with nothing bound; the record of
   that run is the acceptance evidence in the PR.
3. **Skill RED/GREEN** under the same scratch environment, so baselines never
   touch the real estate. `creating-a-pack`: a fresh agent told "create a
   pack for our team on this repo" with no skill; record what it does (the
   expected failure is wrong shape: hand-rolled dirs, a copied pack, invented
   files). The recipe form above is confirmed or replaced by what RED shows.
   `extending-a-pack`: a fresh agent told "make the pipeline check X on our
   repo" with no skill; expected failure is editing the compiled output or
   an engine instead of writing a fill and binding it. Then both with the
   skill present.
4. **Selection micro-tests** for both descriptions in
   `tests/desc-test-scenarios.json`, including a scenario that must pick
   `editing-skills` and not `extending-a-pack`.
5. **Certification** of both skills with `tests/certify.sh` in stack mode
   (purity greps on).

## Repos touched

- `repo-tools`: `commands/skills-init.ts`, the command-tree leaf, the module
  registry entry, the fragment write in `skillsBind` (`commands/skills.ts`),
  tests.
- `mattstack-skills`: two skills under `plugin/skills/`, `templates/domain-pack`
  removed, README Configuration rewritten, desc-test scenarios, version bump.
