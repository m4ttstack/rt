import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { escalationBody, notifyEscalation } from "../triage/notify.ts";

describe("escalationBody", () => {
  test("keeps a short first sentence and appends the board pointer", () => {
    expect(escalationBody("typecheck failed on src/foo.ts. Ran tsc twice.\nMore detail here."))
      .toBe("typecheck failed on src/foo.ts. -- details on the board");
  });

  test("uses the whole first line when there is no sentence terminator", () => {
    expect(escalationBody("rebase blocked by conflict in bun.lock"))
      .toBe("rebase blocked by conflict in bun.lock -- details on the board");
  });

  test("a long multi-sentence diagnosis truncates the first sentence at 120 chars with an ellipsis", () => {
    const firstSentence =
      "The pipeline failed because the typecheck job found forty-one errors across nine files after the rebase picked up the new strict compiler flags from master.";
    const body = escalationBody(`${firstSentence} Second sentence with remediation detail. Third sentence.`);
    expect(body).toBe(`${firstSentence.slice(0, 120).trimEnd()}... -- details on the board`);
    expect(body).not.toContain("Second sentence");
    expect(body.split("\n")).toHaveLength(1);
  });
});

describe("notifyEscalation", () => {
  const sock = join(mkdtempSync(join(tmpdir(), "tray-")), "tray.sock");
  const received: any[] = [];
  const server = Bun.serve({
    unix: sock,
    async fetch(req) {
      received.push({ path: new URL(req.url).pathname, body: await req.json() });
      return new Response("ok");
    },
  });
  afterAll(() => server.stop(true));

  test("rt mode POSTs the tray notify contract to the unix socket", async () => {
    await notifyEscalation("doctor stuck on !12", escalationBody("typecheck failed; diagnosis attached."), "rt", sock);
    expect(received).toHaveLength(1);
    expect(received[0].path).toBe("/notify");
    expect(received[0].body.title).toBe("doctor stuck on !12");
    expect(received[0].body.message).toBe("typecheck failed; diagnosis attached. -- details on the board");
    expect(received[0].body.category).toBe("mr-doctor");
    expect(typeof received[0].body.id).toBe("string");
    expect(typeof received[0].body.timestamp).toBe("number");
  });

  test("badge-only mode is a no-op", async () => {
    await notifyEscalation("t", "m", "badge-only", sock);
    expect(received).toHaveLength(1); // unchanged
  });
});
