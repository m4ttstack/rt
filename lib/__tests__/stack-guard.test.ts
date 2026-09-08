import { describe, expect, test } from "bun:test";

import { checkStackMembership, type StackGuardRunners } from "../stack-guard.ts";

function gitqStore(stacks: { stackName: string; root: string; nodes: { branch: string; parent: string }[] }[]): string {
  return JSON.stringify({ stacks, worktrees: [] });
}

function runners(over: Partial<StackGuardRunners>): StackGuardRunners {
  return {
    gitqStacks: async () => null,
    forgeOpenMrs: async () => ({ ok: true, mrs: [] }),
    ...over,
  };
}

describe("checkStackMembership", () => {
  test("refuses a gitq stack member, naming its stack, parent, and children", async () => {
    const store = gitqStore([
      {
        stackName: "acme-1599",
        root: "master",
        nodes: [
          { branch: "acme-2626-log-call", parent: "master" },
          { branch: "acme-2627-assign", parent: "acme-2626-log-call" },
          { branch: "acme-1599-contacts", parent: "acme-2626-log-call" },
        ],
      },
    ]);
    const verdict = await checkStackMembership({
      cwd: "/repo",
      branch: "acme-2626-log-call",
      defaultBranch: "master",
      runners: runners({ gitqStacks: async () => store }),
    });

    expect(verdict.verdict).toBe("refuse");
    if (verdict.verdict !== "refuse") return;
    expect(verdict.refusal.kind).toBe("stack-refusal");
    expect(verdict.refusal.source).toBe("gitq");
    expect(verdict.refusal.branch).toBe("acme-2626-log-call");
    expect(verdict.refusal.stack).toEqual({
      name: "acme-1599",
      root: "master",
      parent: "master",
      children: ["acme-2627-assign", "acme-1599-contacts"],
    });
    expect(verdict.refusal.tool).toBe("gitq sync --stack acme-1599");
  });
});
