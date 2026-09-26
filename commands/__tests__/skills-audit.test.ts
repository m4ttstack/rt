import { describe, expect, test } from "bun:test";
import { buildAuditInvocation, buildAuditPrompt } from "../skills-audit.ts";
import { buildClaudeArgv } from "../../lib/agent-argv/claude.ts";

const paths = ["/p/skills/ship/SKILL.md", "/p/attachments/f/SKILL.md"];
const tools = [{ name: "git_push", description: "Push the tree's current branch." }, { name: "mr_create", description: "Create an MR." }];
const SESSION = "11111111-1111-4111-8111-111111111111";

describe("buildAuditPrompt", () => {
  test("names every file path and every tool with its description, and no file text", () => {
    const p = buildAuditPrompt(paths, tools);
    for (const f of paths) expect(p).toContain(f);
    for (const t of tools) { expect(p).toContain(t.name); expect(p).toContain(t.description); }
    expect(p).toContain("Read each file");
  });
  test("asks for the three pattern-proof findings and a per-finding file:line", () => {
    const p = buildAuditPrompt(paths, tools);
    expect(p).toContain("plain words");
    expect(p).toContain("shell variables");
    expect(p).toContain("wrapped");
    expect(p).toContain("file:line");
  });
  test("stays small however large the pack is", () => {
    const many = Array.from({ length: 2000 }, (_, i) => `/p/attachments/f${i}/SKILL.md`);
    expect(buildAuditPrompt(many, tools).length).toBeLessThan(120_000);
  });
});

describe("buildAuditInvocation", () => {
  test("is a headless claude run with the prompt, Read allowed, no bypass, no account", () => {
    const inv = buildAuditInvocation("PROMPT", SESSION);
    expect(inv).toMatchObject({ headless: true, prompt: "PROMPT", session: { kind: "start", sessionId: SESSION }, yolo: false, extraArgs: "--allowedTools=Read" });
    const argv = buildClaudeArgv(inv, { claude: "/bin/claude" });
    expect(argv[0]).toBe("/bin/claude");
    expect(argv).toContain("-p");
    expect(argv.slice(argv.indexOf("--output-format"), argv.indexOf("--output-format") + 2)).toEqual(["--output-format", "json"]);
    expect(argv).toContain("--allowedTools=Read");
    expect(argv.at(-1)).toBe("PROMPT");
    expect(argv.some((a) => a.includes("dangerously"))).toBe(false);
    expect(inv.account).toBeUndefined();
  });
});
