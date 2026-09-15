# L4: rt mcp serve scaffold + tools over existing commands (RT-145)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stdio MCP server (`rt mcp serve`) exposing typed tools over EXISTING daemon commands, delivered by the mattstack plugin.

**Architecture:** One command module (`commands/mcp.ts`) that lazily imports the MCP SDK and a tool-registry module (`lib/mcp/tools.ts`) mapping tool names to rt-client calls. Tool handlers read identity env once per call. No daemon changes.

**Tech Stack:** Bun, TypeScript, `@modelcontextprotocol/sdk` (stdio transport), bun test, one e2e.

**Spec:** `docs/superpowers/specs/2026-09-14-gate-seam-mcp-epic-design.md` (Phase 2)

## Global Constraints

- Contract C5 (names, schemas, env rules) and C10 in `docs/superpowers/plans/2026-09-14-gate-seam-00-contracts.md` are binding.
- The SDK import must be lazy (inside the serve handler): `lib/__tests__/no-eager-tui.test.ts` and `scripts/bench-startup.ts` gate startup regressions.
- New command module REQUIRES a `lib/module-registry.ts` thunk entry, or the compiled binary cannot dispatch it.
- Announce before merge (touches command-tree-def.ts + module-registry.ts + package.json).
- Does NOT wait for gate:ask; the roster here is existing commands only. gate_ask/mr_comment_inline/mr_map arrive in wave 2 (RT-151).
- `bun run test:all` before verified. mattstack-skills half (plugin .mcp.json) ships via the editing-skills pipeline (bump + sync), same lane.

---

### Task 1: dependency + tree node + registry

**Files:**
- Modify: `package.json` (add `"@modelcontextprotocol/sdk"` exact-pinned to the current release; run `bun install`)
- Modify: `lib/command-tree-def.ts` (new top-level node)
- Modify: `lib/module-registry.ts` (thunk entry)
- Create: `commands/mcp.ts` (stub that errors "not yet implemented" so the tree is wired before the server exists)

**Interfaces:**
- Produces: tree node `mcp` -> `serve` (hidden), fn `mcpServe` in `./commands/mcp.ts`.

- [ ] **Step 1: Add the tree node**

```ts
mcp: {
  description: "MCP servers rt hosts for agent runtimes",
  subcommands: {
    serve: {
      description: "stdio MCP server over the rt daemon (spawned by the mattstack plugin; not for interactive use)",
      module: "./commands/mcp.ts",
      fn: "mcpServe",
      hidden: true,
      omitBehavior: { exempt: "agent-facing; spawned by a plugin config, takes no positionals" },
      args: [],
    },
  },
},
```

- [ ] **Step 2: Registry thunk + stub module**

```ts
// lib/module-registry.ts addition (exact thunk convention)
"./commands/mcp.ts": () => import("../commands/mcp.ts"),
```

```ts
// commands/mcp.ts (stub for this task)
export async function mcpServe(_args: string[]): Promise<void> {
  console.error("rt mcp serve: not yet implemented");
  process.exit(1);
}
```

- [ ] **Step 3: Verify gates**

Run: `bun run picker:check && bun test lib/__tests__/no-eager-tui.test.ts && bun run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock lib/command-tree-def.ts lib/module-registry.ts commands/mcp.ts
git commit -m "mcp: tree node, registry thunk, SDK dependency"
```

### Task 2: tool registry, test-first

**Files:**
- Create: `lib/mcp/tools.ts`
- Test: `lib/mcp/__tests__/tools.test.ts`

**Interfaces:**
- Consumes: rt-client client functions (`gateAnswer`, `gateList`, `chatPost`... read `packages/rt-client/src/index.ts` for the exact wrapper names; where a wrapper does not exist, call the generic typed command transport the client exposes) and `readChatSession` (`lib/chat-session.ts:53`).
- Produces:

```ts
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  handler(input: Record<string, unknown>, env: NodeJS.ProcessEnv): Promise<{ ok: boolean; body: unknown; error?: string }>;
}
export function mcpTools(): McpToolDef[];
```

Tool list and input shapes EXACTLY per contract C5. Descriptions are one to three sentences; gate_answer's description carries the strict-membership line ("answer values must be option VALUES verbatim; nuance goes in {value, note}") and chat tools' descriptions carry the sign-in-stays-CLI line.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mcpTools } from "../tools.ts";

const NAMES = ["gate_answer","gate_list","chat_post","chat_dm","chat_ack","chat_claim","chat_release","mr_reply_thread","herd_gates","herd_ask","herd_answer","herd_report"];

describe("mcpTools", () => {
  test("roster matches contract C5", () => {
    expect(mcpTools().map((t) => t.name).sort()).toEqual([...NAMES].sort());
  });
  test("every tool has a description and an object schema", () => {
    for (const t of mcpTools()) {
      expect(t.description.length).toBeGreaterThan(20);
      expect((t.inputSchema as { type?: string }).type).toBe("object");
    }
  });
  test("chat_post without a signed-in session errors with the sign-in hint", async () => {
    const tool = mcpTools().find((t) => t.name === "chat_post")!;
    const res = await tool.handler({ room: "rt", body: "x" }, { CLAUDE_CODE_SESSION_ID: "00000000-0000-0000-0000-000000000000" } as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("rt chat sign-in");
  });
});
```

- [ ] **Step 2: Run, expect module-not-found; Step 3: implement** each handler as: read env -> resolve identity (chat: `readChatSession`; herd: HERD_ID/HERD_JOB; gate_answer: `by: "pane"`, `session: env.CLAUDE_CODE_SESSION_ID`) -> call the typed client function -> `{ok, body}` or `{ok:false, error}`. No daemon-unreachable special-casing: the client's error string passes through.

- [ ] **Step 4: Run tests, expect pass; Step 5: commit**

```bash
git add lib/mcp
git commit -m "mcp: tool registry over existing daemon commands"
```

### Task 3: the stdio server

**Files:**
- Modify: `commands/mcp.ts` (replace the stub)
- Test: covered by Task 4's e2e (a stdio server has no meaningful unit seam beyond the registry, already tested)

**Interfaces:**
- Consumes: Task 2's `mcpTools()`; `@modelcontextprotocol/sdk`'s `McpServer` + `StdioServerTransport` (lazy imports).
- Produces: `mcpServe(args: string[])` that serves until stdin closes.

- [ ] **Step 1: Implement**

```ts
// commands/mcp.ts
export async function mcpServe(_args: string[]): Promise<void> {
  const [{ McpServer }, { StdioServerTransport }, { mcpTools }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/mcp.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("../lib/mcp/tools.ts"),
  ]);
  const server = new McpServer({ name: "mattstack", version: "1.0.0" });
  for (const tool of mcpTools()) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (input: Record<string, unknown>) => {
      const res = await tool.handler(input, process.env);
      if (!res.ok) return { isError: true, content: [{ type: "text", text: res.error ?? "failed" }] };
      return { content: [{ type: "text", text: JSON.stringify(res.body) }] };
    });
  }
  await server.connect(new StdioServerTransport());
}
```

Adapt the registerTool call to the PINNED SDK version's real API (read the SDK's README in node_modules first; if the installed major uses `server.tool(name, schema, handler)` or requires zod shapes, follow the SDK, keep the registry's JSON-schema-per-tool contract and convert at this boundary).

- [ ] **Step 2: Manual smoke under isolated HOME**

Run: `printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}\n' | env -i HOME=/tmp/rt-mcp-smoke PATH="$PATH" bun run cli.ts mcp serve`
Expected: one JSON-RPC initialize result on stdout, no crash. (env -i HOME=... per the repo's isolated-HOME rule for anything executing rt.)

- [ ] **Step 3: Commit**

```bash
git add commands/mcp.ts
git commit -m "mcp: stdio server over the tool registry"
```

### Task 4: e2e

**Files:**
- Create: `e2e/tests/mcp-serve.test.ts` (follow the harness conventions of the existing files in `e2e/tests/`; read one first, e.g. the chat delivery e2e, and mirror its setup/teardown)

**Interfaces:**
- Consumes: the e2e harness's isolated-HOME daemon fixture.
- Produces: proof of `initialize` -> `tools/list` (12 tools) -> one `tools/call` of `gate_list` returning `{gates: [], cursor: 0}`-shaped JSON against the test daemon.

- [ ] **Step 1: Write the e2e**: spawn `bun run cli.ts mcp serve` with the fixture env, speak JSON-RPC over stdio: initialize, `tools/list` (assert the 12 names), `tools/call` gate_list (assert ok content). Kill the child in teardown.
- [ ] **Step 2: Run `bun run test:e2e` (this file), then `bun run test:all`.** Expected: PASS.
- [ ] **Step 3: Commit**

```bash
git add e2e/tests/mcp-serve.test.ts
git commit -m "mcp: e2e for initialize/tools-list/tools-call"
```

### Task 5: plugin wiring (mattstack-skills repo)

**Files:**
- Modify: `~/Documents/GitHub/mattstack-skills/.mcp.json` if it exists, else create it at the plugin root the manifest expects (read `.claude-plugin/plugin.json` first; if it declares an `mcpServers` field convention, follow it instead of a separate file... Claude Code accepts both; match how OTHER installed plugins on this machine declare theirs, e.g. the fast-browser plugin's cache dir shows the working layout)
- Modify: `mattstack-skills/.claude-plugin/plugin.json` (version bump)

**Interfaces:**
- Produces: `{"mcpServers": {"mattstack": {"command": "rt", "args": ["mcp", "serve"]}}}`.

- [ ] **Step 1:** Inspect `~/.claude/plugins/cache/mattstack/fast-browser/*/` for the MCP declaration layout that demonstrably works on this machine; replicate it in mattstack-skills.
- [ ] **Step 2:** Bump plugin version, commit both files in mattstack-skills:

```bash
git add .mcp.json .claude-plugin/plugin.json
git commit -m "plugin: declare the mattstack MCP server (rt mcp serve)"
```

- [ ] **Step 3:** After the rt side merges AND rt is on PATH with the new verb: `rt skills sync --pack mattstack`, restart a session, verify the tools appear (deferred list is fine) and one `chat_ack` round trip works.
- [ ] **Step 4:** Do not push mattstack-skills main without the purity habit check for public repos (repo-purity gate applies to rt; mattstack-skills is public too: run the purity script if the repo carries one).

### Task 6: lane wrap

- [ ] `bun run test:all`, `bun run picker:check`, `bun run bench`-equivalent startup check (`bun scripts/bench-startup.ts` if invocable locally) green.
- [ ] Announce in #rt, push, PR "RT-145: rt mcp serve + mattstack plugin wiring".
