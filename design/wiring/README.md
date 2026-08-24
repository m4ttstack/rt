# Wiring surface — design reference

The approved design for `/wiring`, kept here so implementation can be checked
against it rather than against someone's memory of it.

Canvas (editable, hosted): https://claude.ai/code/artifact/a27ffb30-2a5d-48bd-8ac2-ba9305d85a86

| file                   | what it is                                              |
| ---------------------- | ------------------------------------------------------- |
| `artboards/*.dc.html`  | the design source; edit these, never `render/`          |
| `render/*.html`        | generated standalone pages, one per scheme — gitignored |
| `reference/*.png`      | the parity targets, captured from `render/`             |
| `build-references.mjs` | `artboards/` → `render/`                                |
| `capture.sh`           | `render/` → `reference/`                                |

## What the design fixes to

Every value in the artboards is lifted from the app, not eyeballed:

- palette, grid and `@font-face` — `src/app/styles/tokyo-theme.css`
- font sizes, spacing, radii, `fontFamily` — `src/ui/design-system/app-theme.ts`
- surface ladder and text tokens — `src/ui/hooks/useSchemeColors.ts`
- row anatomy and action affordances — `src/app/runs/RunRow.tsx`
- the spine and its "Outside the pipeline" terminal item — `src/app/runs/Timeline.tsx`
- provenance row — `src/app/runs/CommandProvenance.tsx`

Two values are derivations rather than lifts, both because the source has no
such token: `--bg4` (`color-mix` of `--tk-fg` 8% over `--tk-card`, the same
step `tokyo-theme.css` documents) and the badge wash (Mantine's `light`
variant is the hue at 10% in light, 15% in dark).

## Structure is real; health states are not

The pipeline, its stage order, all eighteen binding keys, the four `mr-board`
binders and `stage-implement` genuinely having no slots are read from
`~/.mattstack/repos/gitlab.com-acme-acme-dev/skills.jsonc`.

**Pipeline stages carry no health and no actions, and that is deliberate.** A
stage compiles INTO the orchestrator rather than to an artifact of its own, so
the payload has no `sourcePath`, `artifactPath` or verb for one, and `rt skills
check` covers roster verbs only. Stage bullets are therefore neutral numbers,
and the action cluster appears only on rows that genuinely have a source and an
artifact — the orchestrator and everything outside the pipeline. A green ring
or three buttons on a stage would be a claim nothing measured.

The two health states shown (`work` source-newer, `review` never-compiled) are
**illustrative** — `check` was not run for the draft. Do not treat them as facts
about the pack, and do not write tests that assert them.

Skill descriptions in `CompileDrawer` are rewritten neutral on purpose: the
real ones carry employer identifiers and the canvas is hosted.

## Design laws this surface must hold

1. **The order is the pipeline's execution order**, read from
   `pipelines.<workType>`. Never sorted by health, never reordered under the
   cursor.
2. **A step number is never replaced by a health glyph.** A row in trouble
   still has to say where it runs; health is the bullet's colour plus the
   badge plus the sub-line. Stages never carry a health colour at all — see
   above.
3. **Slots are always open.** Verb → slot → fill is the wiring; it does not
   go behind a chevron.
4. **Health indicates, it never groups.** No bands.
5. **Every panel names the command that produced it** (`CommandProvenance`) —
   the project-wide law stated in that component.
6. **The compile drawer states its own limit.** It shows a fresh `--preview`
   beside the files `check` flagged; it is not a diff against disk, and it
   carries no confirm button, because no write route exists.

## Parity pass

```sh
node design/wiring/build-references.mjs \
  design/wiring/artboards design/wiring/render \
  Main.dc.html Indicators.dc.html CompileDrawer.dc.html InverseIndex.dc.html
bash design/wiring/capture.sh          # re-captures reference/ from render/
```

To check an implementation against the reference: serve the app, open
`/wiring` at 1440 wide in both schemes, screenshot full-page, and compare
against `reference/Main.{light,dark}.png` element by element — surface
colours, border colour, radii, font sizes, the 22px bullet on a 2px line, the
28px action icons, slot column widths.

Two capture constraints worth knowing before you fight them:

- the browser refuses the `file:` protocol, so `render/` must be served over
  http (`capture.sh` does this);
- screenshots can only be written under `~/.fast-browser` or the repo-tools
  checkout, so `capture.sh` shoots there and copies the results back here.
