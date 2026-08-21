import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { notifyBoard, readBoardPort } from "../board-notify.ts";

let dir: string;
let originalPort: string | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bn-"));
  originalPort = process.env.MR_BOARD_PORT;
  delete process.env.MR_BOARD_PORT;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (originalPort === undefined) delete process.env.MR_BOARD_PORT;
  else process.env.MR_BOARD_PORT = originalPort;
});

const SIGNAL = {
  mrUrl: "https://gitlab.com/acme/webapp/-/merge_requests/4821",
  iid: 4821,
  kind: "review" as const,
  status: "reviewing",
};

describe("readBoardPort", () => {
  test("reads the port out of the runtime port file", () => {
    const portFilePath = join(dir, "board-port");
    writeFileSync(portFilePath, "11006");
    expect(readBoardPort(portFilePath)).toBe(11006);
  });

  test("falls back to 7930 when the port file is missing", () => {
    expect(readBoardPort(join(dir, "no-port-file"))).toBe(7930);
  });

  test("MR_BOARD_PORT env wins over the port file", () => {
    process.env.MR_BOARD_PORT = "9001";
    const portFilePath = join(dir, "board-port");
    writeFileSync(portFilePath, "11006");
    expect(readBoardPort(portFilePath)).toBe(9001);
  });

  test("ignores a garbage or empty MR_BOARD_PORT and falls through to the port file", () => {
    process.env.MR_BOARD_PORT = "banana";
    const portFilePath = join(dir, "board-port");
    writeFileSync(portFilePath, "11006");
    expect(readBoardPort(portFilePath)).toBe(11006);

    process.env.MR_BOARD_PORT = "";
    expect(readBoardPort(portFilePath)).toBe(11006);
  });

  test("ignores a garbage or empty port file and falls through to 7930", () => {
    const portFilePath = join(dir, "board-port");
    writeFileSync(portFilePath, "not-a-port");
    expect(readBoardPort(portFilePath)).toBe(7930);

    writeFileSync(portFilePath, "");
    expect(readBoardPort(portFilePath)).toBe(7930);
  });
});

describe("notifyBoard", () => {
  test("posts the signal as json to /agent/status", async () => {
    let seen: unknown;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        seen = { path: new URL(req.url).pathname, method: req.method, body: await req.json() };
        return new Response(JSON.stringify({ ok: true, reacted: true }));
      },
    });
    await notifyBoard(SIGNAL, server.port);
    server.stop(true);
    expect(seen).toEqual({ path: "/agent/status", method: "POST", body: SIGNAL });
  });

  test("skips the post entirely when there is no mrUrl to react to", async () => {
    let hits = 0;
    const server = Bun.serve({ port: 0, fetch() { hits++; return new Response("ok"); } });
    await notifyBoard({ ...SIGNAL, mrUrl: "" }, server.port);
    server.stop(true);
    expect(hits).toBe(0);
  });

  test("an unreachable board resolves instead of throwing", async () => {
    const server = Bun.serve({ port: 0, fetch() { return new Response("ok"); } });
    const dead = server.port;
    server.stop(true);
    expect(await notifyBoard(SIGNAL, dead).then(() => "resolved")).toBe("resolved");
  });

  test("a board error response resolves instead of throwing", async () => {
    const server = Bun.serve({ port: 0, fetch() { return new Response("boom", { status: 502 }); } });
    expect(await notifyBoard(SIGNAL, server.port).then(() => "resolved")).toBe("resolved");
    server.stop(true);
  });
});
