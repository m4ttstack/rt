# Scratch end-to-end evidence: `rt skills init` and the generic pipeline

Run on 2026-09-24 against the merged rt (`main` at 4f3c301f9) inside a Tart clone of the release golden (`skills-init-e2e`, macOS 26.6.2), reached over ssh. Nothing on the developer machine was touched. Names of the test namespaces are written as `acme` and `<owner>` here.

## Environment

- Guest: Command Line Tools 26.6, bun, claude CLI 2.1.281 (subscription login done by the operator over an attached `screen` session), `age` and `age-keygen` copied in, a dev-mode `rt` wrapper at `~/.local/bin/rt` pointing at the shared rt checkout, `mattstack.mode` set to `dev` at machine scope, the daemon run in the foreground (`bun run cli.ts --daemon`).
- Plugins: `mattstack@mattstack` 0.19.3 from a marketplace whose source is a local clone of mattstack-skills at ref `pack-authoring`; `superpowers@claude-plugins-official` 6.4.1.
- Test repo: a GitLab project cloned over HTTPS; the token lived only in the shell environment (an askpass shim that echoes an env var).
- Zone: `rt team create Scratch --remote <empty GitLab project>` succeeded against the real keychain once the keychain was unlocked in the same ssh session (`security unlock-keychain`).

## `rt skills init --repo ~/repos/api --json`

```json
{
  "ok": true,
  "pack": { "name": "scratch", "dir": "~/.mattstack/teams/scratch/mattstack/packs/scratch", "zone": "scratch", "marketplace": "scratch" },
  "repo": { "slug": "gitlab.com-acme-glance-test-repo", "manifest": "~/.mattstack/repos/gitlab.com-acme-glance-test-repo/skills.jsonc" },
  "installed": { "plugin": "scratch@scratch", "version": "0.1.0" },
  "restartNeeded": true,
  "tryNext": "/scratch:work <ticket>"
}
```

`wrote` listed the five pack files, the zone's `team.jsonc`, and the zone's `marketplace.json`. Before the zone existed, the same command refused with `zone-missing` (exit 2, `{ "error": { "code": "zone-missing", "refused": true, ... } }`).

## Checks

- Pack tree: `skills/work`, eight `attachments/stage-*`, `pack/{skills,stubs,surface}.jsonc`.
- Manifest header: `pipeline feature <- scratch@scratch`, `mattstack:work tiering <- scratch@scratch`, `mattstack:stage-watch-ci forge <- scratch@scratch`.
- `rt skills check --pack scratch`: every verb and stage `current`, exit 0.
- `rt skills composition --pack scratch`: `work (mattstack:work) public`, `tiering: mattstack:model-tiering`, `4 fills, 2 binders`.
- `claude plugin list --json`: `scratch@scratch` 0.1.0 enabled.
- No `{{` left in any compiled file.

## The generic pipeline: `/scratch:work add a line "scratch pipeline check" to README.md`

Driven in a fresh guest Claude session (auto mode), gates answered with the recommended option each time.

| Stage | What happened | Fallback taken |
|---|---|---|
| provision | `rt worktree provision --repo <slug>` refused: the slug "did not match a known repo" | Branch `scratch-pipeline-check` made in the checkout itself |
| plan | APPROACH trivial (docs only), EVIDENCE none (no policy bound); tier gate opened; first `rt gate ask` failed with `invalid questions` until each question carried a `multi` field | none |
| gates | "No domain gates are bound for this repo, so the gates stage has nothing to check" | none, by design |
| evidence | nothing bound | none, by design |
| implement | one commit (`docs: add scratch pipeline check line to README`) | none |
| self-review | a reviewer subagent approved with no findings; the plugin stop hook refused to let the turn end mid-stage, and the agent continued | none |
| ship | `glab` absent in the guest; the agent pushed and opened draft MR !188 through the GitLab API with the token from env | API instead of glab |
| watch-ci | the forge fill's attendant scripts need `glab`; the agent claimed the lease and polled the pipeline through the API; CI red from `npm ci` with no lockfile, shown to fail on the last three pipelines on main too; CI gate answered "hand back"; run closed as done | API instead of glab |

Outcome: a draft MR on the test project with the one-line change, a CI verdict (red, pre-existing), the run closed cleanly. The MR was closed after the run.

## Findings

1. **Provisioner does not know a repo `init` registered.** `init` registers the repo in the index (no tracking), and the provision stage passes the run's repo slug to `rt worktree provision --repo`, which only matches tracked repos. The generic fallback (branch in the checkout) works, but a team's first run never gets a pool worktree. Fix candidates: have `init` grant tracking, or have the provision stage resolve the repo by path.
2. **`rt gate ask` rejects a question without `multi`** with only `invalid questions`; the work engine's example omits the field. The engine text or the verb's error should name it.
3. **Ship and watch-ci assume `glab`.** Without it the agent improvised with the API. The generic fills should either say the API path or the setup should install glab. Environment-specific, but a fresh teammate machine without the app would hit it.
4. **`rt team create` needs `age-keygen` on PATH** when the app bundle is absent (it is bundled with the app). Same class as 3.
5. **Onboarding gaps found while building the guest** (not pipeline defects): a global `credential.username` breaks GitHub clones of plugin marketplaces; `rt settings dev-mode dev` needs the dev app bundle, so a source-only machine sets `mattstack.mode` at machine scope instead.

None of these blocked the run, and none needed a domain fill: the zero-fill pack runs the pipeline end to end.

## The two skills, in the same guest

After the pipeline proof, the `creating-a-pack` and `extending-a-pack` skills were written test-first against this guest (baselines and GREEN records live in mattstack-skills under `docs/superpowers/baselines/`). Both GREEN runs self-selected the skill from the plain prompt. The extending run's fill (`ship-lint`, bound to `mattstack:stage-ship`'s `domain` slot) blocked a push on a lint failure and let it through once fixed, with the pipeline itself as the RED and GREEN harness. Two more observations from those runs:

6. **The daemon's team snapshot commits the zone by itself** within about a minute of `init` or a fill write, and pushes when it holds a token. A skill that commits by hand races it; `creating-a-pack` verifies the snapshot commit and pushes instead.
7. **A stale plugin cache survives a version revert.** Reverting a pack to an earlier version left the newer version's cache dir in place, and `claude plugin update` reused it; the fix was another bump.
