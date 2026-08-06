import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { notifyBoard, readBoardPort } from "../board-notify.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "bn-")); });
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MR_BOARD_PORT;
});

const SIGNAL = {
  mrUrl: "https://gitlab.com/acme/webapp/-/merge_requests/4821",
  iid: 4821,
  kind: "review" as const,
  status: "reviewing",
};

describe("readBoardPort", () => {
  test("reads the port out of config.json", () => {
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({ port: 8123 }));
    expect(readBoardPort(p)).toBe(8123);
  });

  test("falls back to 7930 when the config is missing or portless", () => {
    expect(readBoardPort(join(dir, "nope.json"))).toBe(7930);
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({ slack: {} }));
    expect(readBoardPort(p)).toBe(7930);
  });

  test("MR_BOARD_PORT env wins over the port file and config.json", () => {
    process.env.MR_BOARD_PORT = "9001";
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ port: 8123 }));
    const portFilePath = join(dir, "board-port");
    writeFileSync(portFilePath, "11006");
    expect(readBoardPort(configPath, portFilePath)).toBe(9001);
  });

  test("the port file wins over config.json when there is no env override", () => {
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ port: 8123 }));
    const portFilePath = join(dir, "board-port");
    writeFileSync(portFilePath, "11006");
    expect(readBoardPort(configPath, portFilePath)).toBe(11006);
  });

  test("falls back to config.json when the port file is absent", () => {
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ port: 8123 }));
    const portFilePath = join(dir, "nope-board-port");
    expect(readBoardPort(configPath, portFilePath)).toBe(8123);
  });

  test("falls back to 7930 when nothing resolves", () => {
    const configPath = join(dir, "nope.json");
    const portFilePath = join(dir, "nope-board-port");
    expect(readBoardPort(configPath, portFilePath)).toBe(7930);
  });

  test("ignores a garbage or empty MR_BOARD_PORT and falls through to the port file", () => {
    process.env.MR_BOARD_PORT = "banana";
    const configPath = join(dir, "nope.json");
    const portFilePath = join(dir, "board-port");
    writeFileSync(portFilePath, "11006");
    expect(readBoardPort(configPath, portFilePath)).toBe(11006);

    process.env.MR_BOARD_PORT = "";
    expect(readBoardPort(configPath, portFilePath)).toBe(11006);
  });

  test("ignores a garbage or empty port file and falls through to config.json", () => {
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ port: 8123 }));
    const portFilePath = join(dir, "board-port");
    writeFileSync(portFilePath, "not-a-port");
    expect(readBoardPort(configPath, portFilePath)).toBe(8123);

    writeFileSync(portFilePath, "");
    expect(readBoardPort(configPath, portFilePath)).toBe(8123);
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
