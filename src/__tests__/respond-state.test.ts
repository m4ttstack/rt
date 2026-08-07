import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { respondFilePath, writeRespondState, readRespondStates } from "../respond-state.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rp-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const URL_A = "https://gitlab.com/acme/webapp/-/merge_requests/4821";

describe("writeRespondState counts", () => {
  test("round-trips posted and threads", () => {
    const p = respondFilePath(URL_A, dir);
    writeRespondState(p, { mrUrl: URL_A, iid: 4821, status: "queued" }, 1000);
    const done = writeRespondState(p, { status: "done", posted: 2, threads: 3 }, 2000);
    expect(done.posted).toBe(2);
    expect(done.threads).toBe(3);
    expect(readRespondStates(dir).get(URL_A)?.posted).toBe(2);
  });

  test("keeps a zero posted count, which a truthiness merge would drop", () => {
    const p = respondFilePath(URL_A, dir);
    const done = writeRespondState(p, { mrUrl: URL_A, iid: 4821, status: "done", posted: 0, threads: 3 }, 1000);
    expect(done.posted).toBe(0);
    expect(done.threads).toBe(3);
  });

  test("a later write without counts preserves the ones already on file", () => {
    const p = respondFilePath(URL_A, dir);
    writeRespondState(p, { mrUrl: URL_A, iid: 4821, status: "done", posted: 0, threads: 3 }, 1000);
    const resumed = writeRespondState(p, { status: "done", tabId: "w9:t2" }, 2000);
    expect(resumed.posted).toBe(0);
    expect(resumed.threads).toBe(3);
  });

  test("a run that reports no counts leaves them undefined", () => {
    const p = respondFilePath(URL_A, dir);
    const done = writeRespondState(p, { mrUrl: URL_A, iid: 4821, status: "done" }, 1000);
    expect(done.posted).toBeUndefined();
    expect(done.threads).toBeUndefined();
  });
});
