import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { appendAudit } from "../triage/audit.ts";

describe("appendAudit", () => {
  test("appends one JSON line per entry, creating the file and dir", () => {
    const path = join(mkdtempSync(join(tmpdir(), "audit-")), "sub", "doctor-audit.jsonl");
    appendAudit({ ts: 1, mrUrl: "https://x/mr/1", iid: 1, event: "pipeline-red", decision: "dispatch", reason: "edge:pipeline-red" }, path);
    appendAudit({ ts: 2, mrUrl: "https://x/mr/1", iid: 1, event: "pipeline-red", decision: "skip", reason: "cooldown" }, path);
    const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].decision).toBe("dispatch");
    expect(lines[1].reason).toBe("cooldown");
  });
});
