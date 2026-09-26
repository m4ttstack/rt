import { rtCommand } from "../../packages/rt-client/src/index.ts";
import type { Commands } from "../../packages/rt-client/src/index.ts";
import { resolveRepoTarget } from "./mr-target.ts";
import { checkOptional, checkRequired, err, fromResponse, REPO_NAME_RULE, type McpToolDef } from "./shared.ts";

const PROVISION_TIMEOUT_MS = 300_000;
const DISPOSE_TIMEOUT_MS = 120_000;
const REPO_PROP = { repoName: { type: "string", description: "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo." } };

export function worktreeToolDefs(deps: { command: typeof rtCommand } = { command: rtCommand }): McpToolDef[] {
  async function repo(input: Record<string, unknown>): Promise<{ identity: string } | { error: string }> {
    const bad = checkRequired(input, [{ name: "repoName", type: "string" }]);
    if (bad) return { error: bad };
    const t = await resolveRepoTarget({ repoName: input.repoName });
    return t.ok ? { identity: t.identity } : { error: t.error };
  }
  return [
    {
      name: "worktree_provision",
      description: `Claim a worktree for a ticket or branch (from the on-deck pool, or freshly created) and get back its path; then enter it with EnterWorktree in path mode. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...REPO_PROP, ticket: { type: "string" }, ticketTitle: { type: "string" }, branch: { type: "string" }, disposal: { type: "string", enum: ["merge", "job"] }, owner: { type: "string" } },
        required: ["repoName"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "ticket", type: "string" }, { name: "ticketTitle", type: "string" }, { name: "branch", type: "string" }, { name: "disposal", type: "string" }, { name: "owner", type: "string" }]);
        if (bad) return err(bad);
        if (typeof input.ticket !== "string" && typeof input.branch !== "string") return err("pass a ticket (with an optional ticketTitle) or a branch");
        if (input.disposal !== undefined && input.disposal !== "merge" && input.disposal !== "job") return err('"disposal" must be merge or job');
        const r = await repo(input);
        if ("error" in r) return err(r.error);
        const payload: Commands["worktree:provision"]["payload"] = { repoName: r.identity };
        for (const k of ["ticket", "ticketTitle", "branch", "owner"] as const) if (typeof input[k] === "string") payload[k] = input[k] as string;
        if (input.disposal === "merge" || input.disposal === "job") payload.disposal = input.disposal;
        return fromResponse(await deps.command<Commands["worktree:provision"]["data"]>("worktree:provision", payload, { timeoutMs: PROVISION_TIMEOUT_MS }));
      },
    },
    {
      name: "worktree_dispose",
      description: `Dispose a worktree by its tree name (not the one this session sits in); it goes to the restorable trash. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...REPO_PROP, tree: { type: "string", description: "The tree name as worktree list prints it." } }, required: ["repoName", "tree"], additionalProperties: false },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "tree", type: "string" }]);
        if (bad) return err(bad);
        const r = await repo(input);
        if ("error" in r) return err(r.error);
        return fromResponse(await deps.command<Commands["worktree:dispose"]["data"]>("worktree:dispose", { repoName: r.identity, tree: input.tree as string }, { timeoutMs: DISPOSE_TIMEOUT_MS }));
      },
    },
    {
      name: "worktree_stop_holders",
      description: `End the processes rt ties to a worktree (dev servers, watchers), and only those. There is no general kill tool. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...REPO_PROP, tree: { type: "string" } }, required: ["repoName", "tree"], additionalProperties: false },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "tree", type: "string" }]);
        if (bad) return err(bad);
        const r = await repo(input);
        if ("error" in r) return err(r.error);
        return fromResponse(await deps.command<Commands["worktree:stop-holders"]["data"]>("worktree:stop-holders", { repoName: r.identity, tree: input.tree as string }, { timeoutMs: 60_000 }));
      },
    },
  ];
}
