# Review: ACME-1273 point AGENTS.md at the merge request description

Looked this over against the contributor conventions doc and the existing
`AGENTS.md` pointer pattern used elsewhere in the repo. Overall this is a
small, low-risk doc change... three suggestions below, none blocking.

## Findings

- The new pointer paragraph reads a little dense; a short bullet list would
  scan faster than one long sentence.
- `AGENTS.md` already links to the conventions doc from a different section,
  so it is worth cross-referencing rather than duplicating the explanation.
- The placeholder text left in the second paragraph (`<!-- TODO: link -->`)
  should either be filled in or removed before merge.

## Suggested rewrite

```markdown
See the merge request description for the authoritative task context:

- what changed and why
- linked ticket(s)
- rollout / follow-up notes
```

Nothing here blocks the change from landing. Happy to re-look once the
placeholder is resolved.
