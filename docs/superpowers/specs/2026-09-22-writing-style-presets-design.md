# Writing-style presets

## Problem

The board's review and respond skills post comments under the operator's
name. They load a writing-style skill only when
`~/.mattstack/user/skills/preferences.md` names one under `## Writing style`.
Nothing creates that file, nothing in setup mentions it, and the only style
skill that exists is one operator's personal skill. So a new user's reviews and
replies post in the default model voice: em dashes, "Great catch!", "smoking
gun".

The lookup itself is also scattered. The mattstack engine's `review-posting`
names the file, its `receive-review` does not, a compiled team pack carries two
more wordings (one with a different fallback), and the board wrappers' generic
path (the path a new user without a team pack takes) has no voice step at all.

## Goal

A new user picks a writing style during setup, from a few general presets or
their own skill, and every skill that drafts posted prose resolves that choice
the same way.

## Decisions

Ratified with the operator on 2026-09-22.

| Decision | Choice |
| --- | --- |
| Storage | Registered setting `skills.writingStyle`, user and team scope, value = a skill id, no registry default |
| Lookup order | Lives in rt code: setting, then the `preferences.md` section, then the conversational preset |
| Lookup call | Skills call `skills writing-style show` through the mattstack MCP server's curated rt-verb tool (RT-244, its own spec, shipping in the same rt release). No `BASE_PERMISSIONS` entry |
| Unset fallback | `mattstack:writing-style-conversational` (in the resolver, never in the registry row) |
| Presets | Three, shipped in the mattstack plugin: sparse, conversational, structured, plus one shared rules include |
| Own style | Any installed skill id; personal skills can live in the home repo (backed up, and restored onto a new Mac); a scaffold verb copies a preset to start from |
| Setup | A checklist row with a native picker; it blocks Finish and cannot be waived |
| Existing installs | A Writing style section in Settings › General hosts the same row and sheet |
| Ownership | Built by one lane, reviewed by the distribution lane |

## Design

### 1. The setting

A new row in `packages/rt-client/src/settings/registry-defs.ts`, under its
own block:

```ts
// --- skills (writing style) --------------------------------------------
// No `default`: an unset key is what makes the setup row read needs-you.
// The conversational fallback lives in the resolver, never in this row.
{
  key: "skills.writingStyle",
  type: "string",
  scopes: ["user", "team"],
  merge: "replace",
  description: "Skill id that sets the voice for prose posted under your name (reviews, replies, PR descriptions). A team value is the default a member's user value overrides.",
},
```

Only rt reads this key, so delivery is `bun run build` in
`packages/rt-client` (the dist-freshness test) and no npm publish.

### 2. Resolver and verbs

`lib/skills/writing-style.ts` owns the order.

```ts
type WritingStyleSource = "user" | "team" | "preferences" | "fallback";
interface ResolvedWritingStyle { skill: string; source: WritingStyleSource }
```

`resolveWritingStyle()`:

1. `getSetting("skills.writingStyle")`. A value wins; its provenance gives
   `user` or `team`.
2. Otherwise the `## Writing style` section of
   `~/.mattstack/user/skills/preferences.md` (section ends at the next `## `):
   the value on its `writing-style:` line, backticks stripped. No such line
   means no value. Source `preferences`.
3. Otherwise `mattstack:writing-style-conversational`, source `fallback`.

It reads a setting and one file, spawns nothing, and writes nothing, because
every review and respond run calls it.

`rt skills writing-style` is a new branch under `rt skills`:

| Verb | Does |
| --- | --- |
| `show [--json]` | Prints the resolved `{skill, source}`. The one call every drafting skill makes. |
| `list [--json]` | The pickable styles: the three presets (from a catalog in rt with id, label, one-line description, sample line), every installed skill whose id contains `writing-style`, every personal skill in the home repo, and the current value. Each entry carries `installed`. |
| `use [<id>] [--scope user\|team] [--json]` | Links personal skills, checks the id, then `setSetting` at the given scope (default `user`). No id on a TTY opens the picker over `list`; `omitBehavior: "picker"`, gated `isTTY && !json && !RT_BATCH`. |
| `new <name> [--from <preset>] [--json]` | Copies a preset's compiled `SKILL.md` and `pr-description.md` into `~/.mattstack/user/skills/<name>/`, strips compiler comments, rewrites the frontmatter `name`, links it, and prints the `use` command. `omitBehavior: "prompt"`. |

Every `--json` output is the setup `envelope(...)` every `rt setup` verb
prints, and every refusal is exit 2 with the user-error envelope
(`userErrorPayload`, `{error: {code, message}}` on stdout), which is the only
failure shape the app renders as readable copy.

| Verb | Success body | Refusals (exit 2, `error.code`) |
| --- | --- | --- |
| `show` | `{skill, source}` | none |
| `list` | `{current: {skill, source}, options: [{id, label, detail, sample?, kind, installed}]}` | none |
| `use` | `{skill, scope}` | `usage` (no id without a TTY), `bad-id` (shape), `unknown-skill` (not installed; message lists the choices), `no-home-repo` |
| `new` | `{name, path, from}` | `usage` (no name without a TTY), `bad-name`, `bad-preset` (`--from` is not a catalog preset), `exists`, `no-plugin` (the mattstack plugin is not installed), `no-home-repo` |

An option's `kind` is `preset` (a catalog entry), `personal` (a skill in
`~/.mattstack/user/skills/`), or `installed` (any other installed skill whose
id contains `writing-style`). Each id is listed once: a catalog preset found
installed stays `kind: "preset"`. `current` is the resolver's answer, so the
current value is visible even when it is not one of the options.

`use` and `new` refuse with `no-home-repo` while `~/.mattstack/user/.git` is
absent (`homeGitDir` in `lib/setup/steps/home.ts`), the same guard
`setup repo-root set` applies. `setSetting` creates the store directory
itself and `new` writes under `~/.mattstack/user/skills/`, and either write
before `home.init` or `home.restore` clones would make that clone fail on a
non-empty target.

`new` copies from the installed mattstack plugin: its `installPath` from
`claude plugin list --json` (the parser in `lib/setup/pack-cache.ts` drops
that field today, so the plugin-list reader used here keeps it), then
`skills/writing-style-<preset>/`. `<name>` must match
`^[a-z0-9][a-z0-9._-]*$`, so it cannot escape the skills directory.

"Installed" means a `~/.claude/skills/<id>` entry, a skill directory of an
enabled plugin, or a linked personal skill. Plugin skill directories come from
the plugin list the `tool.plugins` probe already reads, so a plan read spawns
no second `claude`. A skill in an installed but disabled plugin counts as not
installed, since it cannot load; the row names the plugin to enable. The three
catalog preset ids are always valid, whatever the install state: Install is
what delivers them, so neither `use` nor the row may refuse one on a fresh Mac.

`use` rejects an id that does not match `^[a-z0-9][a-z0-9._-]*(:[a-z0-9._-]+)?$`
before anything else, because the app's "Use my own skill…" text reaches argv
and a leading dash would parse as a flag.

The new command module gets its `lib/module-registry.ts` thunk.

`show` is marked agent-safe on its command node, so the curated rt-verb tool
on the mattstack MCP server (RT-244) can run it. That server is allowed at
server level on every install set up since RT-174, and the tool ships inside
rt, so a board pane in default permission mode never stops on a prompt at the
style lookup. A machine set up before RT-174 that never reran setup still
prompts once for the server (RT-245 covers that class); a denied prompt fails
the call into section 7's failure path. A Bash call would prompt on every
default-mode pane, and a new allowlist entry would reach new installs only.
`use`, `list` and `new` stay CLI-only: they are for people, the setup row and
the app, not for agents.

### 3. Personal styles in the home repo

A personal style lives at `~/.mattstack/user/skills/<name>/SKILL.md`. The home
repo is backed up off-machine, and a restore onto a new Mac brings the style
and the user-scope setting with it. The home repo never pulls on an
already-set-up Mac (only team clones pull), so there is no later sync to
catch up with.

rt links that directory into `~/.claude/skills` with the existing
`reconcileSkillLinks` (its ownership boundary already keeps it to links it
owns). Linking runs in setup's `skills.link` step, in `new`, and in `use`.
In `skills.link` it runs before the step's "not running from an app bundle"
early return, so a restore through a dev checkout links it too.
`preferences.md` and `overrides.jsonc` sit in the same directory as plain
files and are ignored, since only directories with a `SKILL.md` link.

### 4. Setup row

`skills.writing-style` in the tools group, `kind: "tool"`, `finishGated: true`.
Its `choose` options are the `list` output: the three presets always, plus
every discovered style.

| State | When | Detail | Action |
| --- | --- | --- | --- |
| `needs-you` | before Install (the home repo does not exist yet) | "You'll choose this after Install" | none |
| `needs-you` | after Install, resolver source is `fallback` | "Choose how your reviews and replies read (or run `rt skills writing-style use`)" | `choose` |
| `invalid` | a configured non-preset id is not installed on this Mac | "`<id>` is not installed here" (or "enable `<plugin>`") | `choose` |
| `ready` | configured and installed, or a catalog preset | "Sparse (team default)", "my-voice (yours)", "from preferences.md" | `choose` (to change it) |

Before Install the row offers no pick, because `use` writes the user store
inside `~/.mattstack/user`, and a write there before `home.init` or
`home.restore` clones would make the clone fail on a non-empty target (the
trap `setup repo-root set` already guards), and on a restore would clobber the
restored choice. Install never waits on this row, since finish gates block
Finish only. The pick happens on the Done screen.

It cannot be waived. Today `FINISH_GATED_ROW_IDS` doubles as the waiver list,
so this splits them:

- `WAIVABLE_ROW_IDS` holds the fast-browser row only.
- The gate is enforced where it is read: `finishBlockers` and
  `applyFinishGate` honor a `setup.waived` entry only for a waivable id, so
  `rt settings set setup.waived` cannot clear this row either.
- `setup waive` refuses a non-waivable id. `setup unwaive` still accepts any
  finish-gated id, so a stale entry can be removed.
- `Row` gains `waivable: boolean`, which rt always emits on a finish-gated row.

The row's action is a new contract type:

```ts
| { type: "choose"; label: string; verb: string[];
    options: { id: string; label: string; detail: string; sample?: string }[];
    other?: { label: string; hint: string } }
```

`verb` is `["skills", "writing-style", "use"]`; the app appends the picked id.
`other` is "Use my own skill…", which collects a skill id (hint: "any installed
skill id; start one with `rt skills writing-style new`") and runs the same verb,
so validation lives in one place.

The CLI `rt setup` walk prints the plan and never runs row actions, so it
needs no change. The row's detail names the command.

Compatibility: an app that predates `choose` decodes it as `.unknown` and
`RowView` hides the button, leaving a needs-you row whose detail still names
the command. rt ships inside the app bundle, so that pairing only occurs with
the dev flavor. `CONTRACT_VERSION` stays 1 because the change is additive.

### 5. App

`Sources-core`: `ActionType.choose`, the option and `other` models,
`DispatchedAction.chooseOption(...)`, and dispatch to
`.rtVerb(args: verb + [id, "--json"])` once an id is picked. `PlanRow` decodes
an absent `waivable` on a finish-gated row as `true`, so a new app on an older
rt keeps Fast Browser's Skip.

`ChooseSheet` lists each option's label, detail and sample line, with "Use
this style" and the "Use my own skill…" field. It follows `ConnectSheet`'s
structure and tokens. Three places open it:

- **Checklist:** `ChecklistScreen.run`, alongside `chooseFolder`.
- **Done:** `DoneScreen.show(row)` handles `choose` (today it handles only
  `openURL`, `steps` and `run`, and anything else falls through). Done's Skip
  button is gated on `waivable`, and the skip sheet's copy stays bound to the
  Fast Browser row. A test asserts every finish-gated row's non-null action
  type is handled on Done, so a user can never reach Done with a blocker whose
  button does nothing (a row with no action, like this one before Install,
  shows no button at all).
- **Settings › General:** a Writing style section hosting the same row and
  sheet. It's the native path for installs that finished setup before this
  row existed. Those installs are not nagged by the app: only the wizard's
  Done screen reads finish blockers. On the CLI they will see
  `Finish: blocked by: skills.writing-style` in `rt setup` status and a `warn`
  line from `rt verify` (`commands/verify.ts:97` keeps finish-gated rows out
  of critical failures but still reports them) until they choose.

Built into a scratch directory, never over a blessed bundle, and screenshotted
in light and dark (checklist, Done and Settings) before it is called done.

### 6. Presets

In mattstack-skills, as compiled verbs of the mattstack pack itself, because
`{{include:}}` resolves only at compile time and includes cannot nest.

```
attachments/writing-style-floor/SKILL.md                    include
attachments/writing-style-lookup/SKILL.md                   include (section 7)
attachments/writing-style/writing-style-sparse/SKILL.md     engine
attachments/writing-style/writing-style-sparse/pr-description.md
attachments/writing-style/writing-style-conversational/…    same shape
attachments/writing-style/writing-style-structured/…        same shape
```

The directory names are what the compiler resolves, so they are exact:

- `loadInclude` (`lib/skills/sources.ts`) finds an include only at
  `attachments/<name>/`, flat, so both includes sit at the top level.
- `loadStepSource` finds an engine at `attachments/<engine>/` or one group
  level down at `attachments/<group>/<engine>/`, matching the directory name.
  So each engine's directory is named `writing-style-<preset>`, the stub says
  `"engine": "writing-style-<preset>"`, and the group directory
  `writing-style/` never collides with a compiled verb's
  `attachments/<verb>/` output (the collision `tests/stubs-no-source-collision.sh`
  guards against).

`pack/stubs.jsonc` rosters `writing-style-sparse`,
`writing-style-conversational` and `writing-style-structured`, compiled to
`skills/writing-style-*/` (skill ids `mattstack:writing-style-*`, with
`pr-description.md` vendored beside each). `surface.jsonc` lists all three as
public. Descriptions say to load the skill only when
`rt skills writing-style show` names it, so three presets never compete to
auto-trigger on "drafting a review".

Each preset mirrors the section order of the operator's personal style skill,
the reference that already works well: hard rules, the compression pass,
voice, review findings, review summary, replies on your own PR, PR
descriptions (pointing at the companion file), commit messages.

**Floor (shared by all three):** no em or en dashes; no agent-tell phrasing
("smoking gun", "load-bearing", "the plot thickens" and kin); no praise or
thanks openers ("Great catch", "You're right"); no corporate-speak ("ensure",
"facilitate", "in order to") or announcement openers ("worth flagging:", "took
a look"); a required compression pass before posting, whose target each preset
sets; evidence shown as output, not prose; one reason and one ask; comment on
the diff, not the MR's scope; a one-line review summary that never recaps
findings.

| | sparse | conversational | structured |
| --- | --- | --- | --- |
| Case | lowercase technical prose, sentence case for social lines | sentence case | sentence case |
| Markup in comments | none but the bold Conventional Comments label and code | label, code, rare emphasis | label, short bullets allowed |
| Finding shape | claim, mechanism, impact, suggestion as a question, concession only when real; 2 to 4 sentences | the same beats as short friendly paragraphs, contractions welcome | the beats as labelled lines (Problem, Why, Suggestion) |
| PR description | about 150 words: framing line, bold-labelled bullet groups | about 200 words, plain paragraphs plus bullets | Summary, Changes, Testing, Follow-up headings |

Every `pr-description.md` keeps the repo's own PR/MR template sections when one
exists and fills them in the preset's voice.

Stripped from anything public: personal names, the employer and its repos,
named colleagues, the employer's MR template, internal ticket prefixes, and
domain examples (replaced with neutral ones). `tests/certify.sh` (stack mode)
and `tests/repo-purity.sh` enforce this.

### 7. The lookup line

`writing-style-lookup` holds the one instruction every drafting skill carries:

> Before drafting, call `mcp__plugin_mattstack_mattstack__rt_verb` with
> `{"args": ["skills", "writing-style", "show"]}` and load the skill its
> `skill` names. That load is step one: compose in that voice from the first
> word, never as a pass over a finished draft. If the tool is unavailable,
> refused, or fails, load the skill named on the `writing-style:` line of
> `~/.mattstack/user/skills/preferences.md` if there is one. If that is
> missing too, or the skill will not load, load
> `mattstack:writing-style-conversational`.

The failure path repeats one rung of the order on purpose. Plugin and pack
updates travel apart from rt's own updates, so a Mac can hold the new skills
and an rt without the tool, and that Mac should still keep a style declared in
`preferences.md`. Reading that file sits outside the pane's working
directory, so in default permission mode it may prompt; a denied read falls
through to conversational.

`review-posting` is itself an include target (`{{include:review-posting}}` in
the `review` engine), and an include target must be inert, so the lookup
cannot go inside it. It goes into the `review` engine body instead, on the
line before `{{include:review-posting}}`.

| Where | Change |
| --- | --- |
| mattstack `review` engine | `{{include:writing-style-lookup}}` added on the line before `{{include:review-posting}}` |
| mattstack `review-posting` | Its `## Writing style` section is deleted |
| mattstack `receive-review` | The Voice bullet becomes `{{include:writing-style-lookup}}` (an engine, so the include is legal) |
| team pack `review-criteria`, `reply-rules` | Voice sections deleted; the engine now covers review and respond |
| team pack `ship-domain` | Step 10 includes the lookup; the structure rule becomes "keep the repo MR template's sections" |
| mattstack-apps board `review`, `respond` | The generic no-domain-skill path gains the same instruction as hand-written text |

`preferences.md` itself is untouched: other skills still read its other
sections (dev process runner, standing rules).

## Rollout

One PR per repo, each reviewed by the distribution lane. This rides the rt
release after the next one, whose scope is already fixed.

1. **mattstack-skills, presets:** floor, three presets, stubs, surface, plugin
   bump, `rt skills sync --pack mattstack`. They're inert until something
   names them, so this merges first.
2. **repo-tools:** setting, resolver, verbs, personal-skill linking, setup row,
   `choose` contract, app (checklist, Done, Settings). Marking `show`
   agent-safe needs RT-244's `CommandNode.agentSafe` field and snapshot test,
   so that one line lands after the RT-244 lane merges. The rt release that
   ships the row must also carry a marketplace catalog pin (the release's
   catalog refresh step) that includes the presets. Otherwise the row offers
   presets the installed plugin lacks.
3. **Lookup-line changes** (mattstack-skills lookup include, team pack fills,
   board wrappers) merge after the rt release carrying both `show` and the
   RT-244 tool has shipped. The failure path
   in section 7 covers anyone who has not taken the rt update yet. The team
   pack recompiles through `rt skills sync --pack <pack>`.

## Testing

- **Resolver:** user beats team, team beats `preferences.md`, the
  `preferences.md` parse (keyed line with and without backticks, no keyed
  line, missing section, missing file), the fallback.
- **Verbs:**
  - `use` refuses an unknown id and lists the choices, and refuses a bad id
    shape (a leading dash included) before any lookup.
  - `use` accepts a catalog preset with the mattstack plugin absent.
  - `use` and `new` refuse with `no-home-repo` and write nothing while
    `~/.mattstack/user/.git` is absent.
  - `use --json` prints `{skill, scope}`; each refusal is exit 2 with its
    `error.code` from the table in section 2.
  - `new` refuses a bad name (`../x`), an existing directory, and a missing
    mattstack plugin.
  - `skills.link` links personal skills when not running from an app bundle.
  - `use` with a personal skill links it first.
  - `new` output has no compiler comments and has the right `name`.
  - The `show --json` envelope in an e2e test.
  - `show` is marked agent-safe; `use`, `list` and `new` are not.
  - The picker-conformance gate and the module registry.
- **Setup:**
  - Each row state, including the no-action row before Install.
  - A team default naming a preset reads ready on a fresh Mac.
  - Finish-gated in status mode.
  - A `setup.waived` entry for this row is ignored by `finishBlockers` and
    `applyFinishGate`.
  - `setup waive` refuses the row and `setup unwaive` still clears it.
  - `waivable` is emitted on every finish-gated row.
  - The contract snapshot.
- **App:**
  - Decode tests for `choose`, for an unknown type, and for a finish-gated row
    with no `waivable` (reads `true`).
  - Dispatcher tests for the picked and "own skill" paths.
  - Every finish-gated row's non-null action type is handled on Done.
  - The sheet rendered and screenshotted in both schemes from the checklist,
    Done and Settings.
- **Presets** (superpowers:writing-skills, test-first). Fixtures: a diff with a
  real bug (finding plus summary), a reviewer comment on your own PR (reply),
  a change to describe (PR description), and a commit.
  - RED: a fresh agent drafts all four with no style.
  - GREEN: the same fixtures under each preset.
  - Reference: the same fixtures under the operator's personal style skill;
    sparse must land close to it in length and shape.
  - Floor: violations checked mechanically (dash bytes, the banned phrase list).
  - After compiling, read every compiled preset in full.

## Out of scope

- A UI for setting the team default (`rt settings set skills.writingStyle
  '"<id>"' --scope team` covers it).
- A voice hook in the engine's own `ship` for packs other than the one above.
- The board `doctor` skill's escalation wording.
