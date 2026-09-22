# AGENTS.md -- apps/board

UI colour and type in this app follow the repo-wide authoring guide:
`docs/ui-authoring.md` at the repo root. Read it before writing any
colour, contrast, or font decision; tokens are picked by role there,
and raw values fail lint and the contrast gates.

Board-specific: visual changes regenerate the capture baselines
(`bun run capture:baseline` in apps/board) only when the change is
intentional; `capture:compare` is the gate that catches the rest.
