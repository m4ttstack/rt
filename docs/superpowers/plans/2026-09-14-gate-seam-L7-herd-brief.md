# L7: rt herd brief (RT-148)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assemble a shepherd job brief mechanically from the template + strategy body + fills, replacing the "two verbatim copies, never retype" discipline.

**Architecture:** Pure CLI (no daemon): a `lib/herd-brief.ts` assembler with explicit file inputs (rt never guesses skill paths; the shepherd passes ${CLAUDE_SKILL_DIR}-anchored paths), surfaced as `rt herd brief`.

**Tech Stack:** Bun, TypeScript, bun test.

**Spec:** `docs/superpowers/specs/2026-09-14-gate-seam-mcp-epic-design.md` (Phase 3)

## Global Constraints

- Contract C8 + C10 binding.
- `herd` already has a subcommand map in `lib/command-tree-def.ts:217`; `brief` joins it (module `./commands/herd.ts` per the siblings, or a separate module... follow how commands/herd.ts organizes fns; if it is one module, add the fn there and skip the registry change since that module is already registered).
- Read the REAL template before coding: `~/Documents/GitHub/mattstack-skills/attachments/orchestration/shepherdr/references/job-template.md` and `parts/strategy/references/strategies.md` in the COMPILED skill (`~/Documents/GitHub/mattstack-skills/skills/shepherdr/`). The slot marker syntax in those files is the parsing contract; if the template's markers are not literal `<angle-bracket>` tokens, adapt the parser to what the file actually uses and note it in the PR.
- The shepherdr engine's prose update (telling shepherds to call this verb) is SKILLS-66's, not this lane's.
- `bun run test:all` + `bun run picker:check` before verified; announce before merge.

---

### Task 1: assembler, test-first

**Files:**
- Create: `lib/herd-brief.ts`
- Test: `lib/__tests__/herd-brief.test.ts` (fixture template + strategies text inline in the test)

**Interfaces:**
- Produces:

```ts
export interface BriefInputs {
  template: string;              // job-template.md content
  job: string;
  fills: Record<string, string>; // slot name (marker text without brackets) -> value
  method:
    | { kind: "strategy"; strategies: string; name: string } // extract the named body
    | { kind: "file"; content: string };                      // domain-supplied Method block
}
export type BriefResult =
  | { ok: true; brief: string }
  | { ok: false; error: string; leftover?: string[] };
export function assembleBrief(inputs: BriefInputs): BriefResult;
```

Behavior: copy template verbatim; substitute each fill at its marker; insert the method body under `## Method` (replacing the template's method slot); a strategy name absent from the strategies file is an error naming the available names; any UNFILLED marker left in the output is an error listing them in `leftover` (the anti-drift guarantee).

- [ ] **Step 1: failing tests**: happy path with a 3-slot fixture; unknown strategy name; leftover markers listed; method-file variant bypasses the strategies file entirely.
- [ ] **Step 2-4:** red, implement, green.
- [ ] **Step 5: Commit** `herd-brief: mechanical brief assembly`.

### Task 2: the verb

**Files:**
- Modify: `commands/herd.ts` (fn `brief`: parse flags per C8, read the files, call `assembleBrief`, write `--out` or print, always `--json`-shaped result `{"ok":true,"path":...}` / `{"ok":true,"brief":"..."}` when no `--out`)
- Modify: `lib/command-tree-def.ts` herdSubcommands:

```ts
brief: {
  description: "Assemble a job brief from the shepherd skill's template + strategy body (paths passed explicitly)",
  module: "./commands/herd.ts",
  fn: "brief",
  omitBehavior: { exempt: "agent-facing; the shepherd passes every path and fill explicitly" },
  args: [
    { name: "Job", flag: "--job", type: "text", placeholder: "acme-1483-facts", hint: "Job name; fills the template's job slot" },
    { name: "Template", flag: "--template", type: "text", placeholder: "<skill-dir>/references/job-template.md", hint: "job-template.md path (from the shepherd skill's own directory)" },
    { name: "Strategies", flag: "--strategies", type: "text", placeholder: "<skill-dir>/parts/strategy/references/strategies.md", hint: "Strategy bodies file; required with --strategy" },
    { name: "Strategy", flag: "--strategy", type: "text", placeholder: "direct-tdd", hint: "Strategy body to copy in as ## Method (mutually exclusive with --method-file)" },
    { name: "Method file", flag: "--method-file", type: "text", placeholder: "method.md", hint: "Domain-supplied Method block (mutually exclusive with --strategy)" },
    { name: "Fence", flag: "--fence", type: "text", placeholder: "/path/to/worktree", hint: "Write-fence value for the template's fence slot" },
    { name: "Branch", flag: "--branch", type: "text", placeholder: "acme-1483-facts", hint: "Branch slot value" },
    { name: "Out", flag: "--out", type: "text", placeholder: "brief.md", hint: "Write the brief here; omit to print it" },
    { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable result" },
  ],
},
```

- [ ] **Step 1:** implement; **Step 2:** run for real against the installed shepherdr skill's actual template (`bun run cli.ts herd brief --job smoke --template ~/Documents/GitHub/mattstack-skills/skills/shepherdr/references/job-template.md --strategies ~/Documents/GitHub/mattstack-skills/skills/shepherdr/parts/strategy/references/strategies.md --strategy direct-tdd`); read the output brief in full and confirm every section landed and no marker leaked. If the real template's slots do not match the flag set (extra slots exist), extend `--fill name=value` (repeatable) rather than adding one flag per slot, and update C8 via a note in the PR + a comment in the contracts doc.
- [ ] **Step 3:** `bun run picker:check` + `bun run test` green. **Step 4: Commit** `herd brief: CLI over the assembler`.

### Task 3: lane wrap

- [ ] `bun run test:all`; announce; push; PR "RT-148: rt herd brief".
