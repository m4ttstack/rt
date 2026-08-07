import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeDoctorState } from "../doctor-state.ts";

describe("doctor state origin", () => {
  test("origin persists across subsequent patches", () => {
    const path = join(mkdtempSync(join(tmpdir(), "doc-")), "s.json");
    writeDoctorState(path, { mrUrl: "https://x/mr/1", iid: 1, status: "queued", origin: "auto" });
    const next = writeDoctorState(path, { status: "diagnosing" });
    expect(next.origin).toBe("auto");
  });
});
