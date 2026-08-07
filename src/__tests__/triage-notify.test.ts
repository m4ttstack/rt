import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { notifyEscalation } from "../triage/notify.ts";

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
    await notifyEscalation("doctor stuck on !12", "typecheck failed; diagnosis attached", "rt", sock);
    expect(received).toHaveLength(1);
    expect(received[0].path).toBe("/notify");
    expect(received[0].body.title).toBe("doctor stuck on !12");
    expect(received[0].body.message).toContain("typecheck");
    expect(received[0].body.category).toBe("mr-doctor");
    expect(typeof received[0].body.id).toBe("string");
    expect(typeof received[0].body.timestamp).toBe("number");
  });

  test("badge-only mode is a no-op", async () => {
    await notifyEscalation("t", "m", "badge-only", sock);
    expect(received).toHaveLength(1); // unchanged
  });
});
