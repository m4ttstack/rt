import { describe, expect, test } from "bun:test";
import { mcpTools } from "../tools.ts";

const NAMES = ["gate_answer","gate_list","chat_post","chat_dm","chat_ack","chat_claim","chat_release","mr_reply_thread","herd_gates","herd_ask","herd_answer","herd_report"];

describe("mcpTools", () => {
  test("roster matches the published tool names", () => {
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

  test("gate_answer without id returns a field error naming id", async () => {
    const tool = mcpTools().find((t) => t.name === "gate_answer")!;
    const res = await tool.handler({ answers: { q1: "yes" } }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("id");
  });

  test("herd_ask without HERD_ID errors mirroring the CLI's worker-pane text", async () => {
    const tool = mcpTools().find((t) => t.name === "herd_ask")!;
    const res = await tool.handler({ questions: [] }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("HERD_ID and HERD_JOB are not set");
  });

  test("herd_report without HERD_ID errors mirroring the CLI's worker-pane text", async () => {
    const tool = mcpTools().find((t) => t.name === "herd_report")!;
    const res = await tool.handler({ body: "status" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("HERD_ID and HERD_JOB are not set");
  });

  test("chat_dm without a signed-in session errors with the sign-in hint", async () => {
    const tool = mcpTools().find((t) => t.name === "chat_dm")!;
    const res = await tool.handler({ to: "someone", body: "x" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("rt chat sign-in");
  });

  test("gate_list description does not claim an open default", () => {
    const tool = mcpTools().find((t) => t.name === "gate_list")!;
    expect(tool.description).not.toContain("defaulting to open");
    expect(tool.description).toContain("all statuses");
  });
});
