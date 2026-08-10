import { test, expect } from "bun:test";
import { isWebSocketUpgrade, requestedProtocols, safeCloseCode, upstreamUrl } from "./ws-proxy.ts";

const req = (headers: Record<string, string>) => new Request("http://x/", { headers });

test("a real upgrade request is recognised", () => {
  expect(isWebSocketUpgrade(req({ upgrade: "websocket", connection: "Upgrade" }))).toBe(true);
});

test("header casing does not matter", () => {
  expect(isWebSocketUpgrade(req({ Upgrade: "WebSocket", Connection: "upgrade" }))).toBe(true);
});

test("Connection is a list in practice, so a token match is required", () => {
  // Browsers and proxies send "keep-alive, Upgrade"; equality checks miss it.
  expect(isWebSocketUpgrade(req({ upgrade: "websocket", connection: "keep-alive, Upgrade" }))).toBe(true);
});

test("an ordinary request is not an upgrade", () => {
  expect(isWebSocketUpgrade(req({}))).toBe(false);
  expect(isWebSocketUpgrade(req({ connection: "keep-alive" }))).toBe(false);
});

test("Upgrade without a Connection token is not an upgrade", () => {
  expect(isWebSocketUpgrade(req({ upgrade: "websocket", connection: "keep-alive" }))).toBe(false);
});

test("vite-hmr is parsed off the subprotocol header", () => {
  // Vite's HMR client rejects a handshake that comes back without this.
  expect(requestedProtocols("vite-hmr")).toEqual(["vite-hmr"]);
});

test("a subprotocol preference list keeps its order", () => {
  expect(requestedProtocols("vite-hmr, graphql-ws")).toEqual(["vite-hmr", "graphql-ws"]);
});

test("an absent subprotocol header yields no protocols", () => {
  expect(requestedProtocols(null)).toEqual([]);
  expect(requestedProtocols("")).toEqual([]);
});

test("close codes that cannot be sent collapse to 1000", () => {
  // 1005/1006 are reported by the runtime but forbidden on the wire.
  expect(safeCloseCode(1005)).toBe(1000);
  expect(safeCloseCode(1006)).toBe(1000);
  expect(safeCloseCode(undefined)).toBe(1000);
  expect(safeCloseCode(999)).toBe(1000);
  expect(safeCloseCode(5000)).toBe(1000);
});

test("legitimate close codes pass through", () => {
  expect(safeCloseCode(1000)).toBe(1000);
  expect(safeCloseCode(1001)).toBe(1001);
  expect(safeCloseCode(1011)).toBe(1011);
  expect(safeCloseCode(4000)).toBe(4000);
});

test("upstream url keeps the path and query the client asked for", () => {
  expect(upstreamUrl(4101, "/", "")).toBe("ws://127.0.0.1:4101/");
  expect(upstreamUrl(4101, "/hmr", "?token=abc")).toBe("ws://127.0.0.1:4101/hmr?token=abc");
});
