import { describe, expect, test } from "bun:test";
import { KEPT_ON_BASH, lintPackDir, lintSkillText, MCP_LINT_RULES } from "../mcp-lint.ts";

const md = (...lines: string[]) => lines.join("\n");

describe("lintSkillText: one hit per rule", () => {
  const cases: Array<[string, string, string]> = [
    ["rt-runs", "```bash\nrt runs stage-start --stage plan\n```", "run_stage"],
    ["glab", "Run `glab mr view 12 --json`.", "mr_view"],
    ["git-push", "```sh\ngit push -u origin feat/x\n```", "git_push"],
    ["git-rebase", "then `git rebase origin/main`", "git_rebase"],
    ["git-pull", "`git pull` first", "git_pull"],
    ["rt-herd", "```\nrt herd spawn --job a\n```", "herd_spawn"],
    ["rt-worktree", "`rt worktree provision --repo x --ticket T-1`", "worktree_provision"],
    ["rt-sync", "```bash\ncd <tree> && rt sync --json\n```", "branch_sync"],
    ["run-db-env", "```\nexport RT_RUN_DB=/x\n```", "run_start"],
    ["subst", "```bash\nIID=$(glab mr list --json | jq .[0].iid)\n```", "mr_for_branch"],
    ["worktree-add", "`git worktree add ../sibling feat/x`", "worktree_provision"],
    ["gate-ask", "```\nrt gate ask --questions \"$(jq -c .questions f)\"\n```", "gate_ask"],
    ["pkill", "`pkill -f <path>` then `kill $PID`", "worktree_stop_holders"],
  ];
  for (const [rule, text, tool] of cases) {
    test(`${rule} hits and names ${tool}`, () => {
      const hits = lintSkillText(text, "a/SKILL.md");
      expect(hits.length, text).toBeGreaterThan(0);
      expect(hits[0]!.rule).toBe(rule);
      expect(hits.map((h) => h.tool)).toContain(tool);
      expect(hits[0]!.file).toBe("a/SKILL.md");
      expect(hits[0]!.line).toBeGreaterThan(0);
    });
  }
  test("every rule in MCP_LINT_RULES has a case above", () => {
    expect(MCP_LINT_RULES.map((r) => r.id).sort()).toEqual(cases.map((c) => c[0]).sort());
  });
});

describe("lintSkillText: no hits", () => {
  test("the kept-on-Bash list", () => {
    const kept = md(
      "```bash", "rt gate answer <id> --answers '<json>' --by shepherd", "rt gate wait <id>", "rt chat tail", "rt events wait 'run:*'",
      "git rebase --continue", "git rebase --skip", "git commit -m x", "git add -A", "git fetch origin", "git merge-base HEAD origin/main", "```",
    );
    expect(lintSkillText(kept, "k.md")).toEqual([]);
    expect(KEPT_ON_BASH.length).toBeGreaterThan(0);
  });
  test("prose that names a tool", () => {
    const prose = md(
      "Push with the `git_push` tool (`tree`, `setUpstream: true`).",
      "Start the run with `run_start`; keep its `runDb`.",
      "Call `rt_verb` with args [\"herd\", \"status\"].",
      "Merge with `mr_merge`; GitLab still enforces approvals.",
      "Provision with `worktree_provision`, then EnterWorktree by path.",
    );
    expect(lintSkillText(prose, "p.md")).toEqual([]);
  });
  test("plain prose outside code is not linted (the audit covers it)", () => {
    expect(lintSkillText("Then push the branch and open the MR.", "p.md")).toEqual([]);
  });
  test("the allow marker excuses its own line and the code line under a marker-only line", () => {
    const allowed = md(
      "Never hand-build a `glab api` call. <!-- mcp-lint: allow -->",
      "- the `glab` CLI (authenticated) <!-- mcp-lint: allow -->",
      "<!-- mcp-lint: allow -->",
      "`git push --force` is what this guard exists to stop.",
      "```bash",
      "<!-- mcp-lint: allow -->",
      "git rebase -i HEAD~3",
      "```",
    );
    expect(lintSkillText(allowed, "a.md")).toEqual([]);
  });
  test("the marker excuses one line only, never the rest of a block", () => {
    const partly = md("```bash", "<!-- mcp-lint: allow -->", "git push", "git rebase origin/main", "```");
    const hits = lintSkillText(partly, "a.md");
    expect(hits.map((h) => h.rule)).toEqual(["git-rebase"]);
  });
});

describe("lintPackDir", () => {
  test("walks skills, attachments and plugin/skills markdown only", () => {
    const files: Record<string, string> = {
      "/p/skills/work/SKILL.md": "```\nrt runs snapshot\n```",
      "/p/attachments/fill/SKILL.md": "`glab mr view 1`",
      "/p/plugin/skills/x/SKILL.md": "`git push`",
      "/p/README.md": "`git push`",
      "/p/skills/work/notes.txt": "`git push`",
    };
    const hits = lintPackDir("/p", { list: () => Object.keys(files), read: (p) => files[p] ?? "" });
    expect(hits.map((h) => h.file).sort()).toEqual(["/p/attachments/fill/SKILL.md", "/p/plugin/skills/x/SKILL.md", "/p/skills/work/SKILL.md"]);
  });
});
