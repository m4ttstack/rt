import { test, expect } from "bun:test";
import { interpretProbe, parseHmrPort, parseHmrProtocol, isHostBlocked, type Probe } from "./preflight.ts";

const CTX = { app: "devapp", devPort: 4101, publicHost: "devapp.example.dev" };

// Captured from devapp's running dev server before it was configured, so the
// unconfigured fixtures below are real output rather than invented shapes.
const UNCONFIGURED_CLIENT = `
const importMetaUrl = new URL(import.meta.url);
const socketProtocol = null || (importMetaUrl.protocol === "https:" ? "wss" : "ws");
const hmrPort = null;
const socketHost = \`\${null || importMetaUrl.hostname}:\${hmrPort || importMetaUrl.port}\`;
`;

const CONFIGURED_CLIENT = `
const importMetaUrl = new URL(import.meta.url);
const socketProtocol = "wss" || (importMetaUrl.protocol === "https:" ? "wss" : "ws");
const hmrPort = 443;
`;

const BLOCKED_BODY =
  'Blocked request. This host ("devapp.example.dev") is not allowed.\n' +
  'To allow this host, add "devapp.example.dev" to `server.allowedHosts` in vite.config.js.';

const codes = (p: Probe) => interpretProbe(p, CTX).map((i) => i.code);

test("unset HMR literals read as null", () => {
  expect(parseHmrPort(UNCONFIGURED_CLIENT)).toBeNull();
  expect(parseHmrProtocol(UNCONFIGURED_CLIENT)).toBeNull();
});

test("configured HMR literals are read exactly", () => {
  expect(parseHmrPort(CONFIGURED_CLIENT)).toBe(443);
  expect(parseHmrProtocol(CONFIGURED_CLIENT)).toBe("wss");
});

test("a blocked host is recognised from Vite's 403", () => {
  expect(isHostBlocked(403, BLOCKED_BODY)).toBe(true);
});

test("an ordinary 403 from the app is not a blocked host", () => {
  // An app's own authorization failure must not be reported as missing config.
  expect(isHostBlocked(403, "Forbidden")).toBe(false);
});

test("a 200 is never a blocked host", () => {
  expect(isHostBlocked(200, "not allowed")).toBe(false);
});

test("nothing listening reports only dev-server-down", () => {
  expect(codes({ reachable: false })).toEqual(["dev-server-down"]);
});

test("devapp's real unconfigured state reports both fixable issues", () => {
  expect(codes({
    reachable: true,
    host: { status: 403, body: BLOCKED_BODY },
    viteClient: { status: 200, body: UNCONFIGURED_CLIENT },
  })).toEqual(["host-blocked", "hmr-not-tunnel-ready"]);
});

test("a fully configured Vite dev server reports nothing", () => {
  expect(codes({
    reachable: true,
    host: { status: 200, body: "<!doctype html>" },
    viteClient: { status: 200, body: CONFIGURED_CLIENT },
  })).toEqual([]);
});

test("allowedHosts fixed but HMR still unset leaves one issue", () => {
  expect(codes({
    reachable: true,
    host: { status: 200, body: "<!doctype html>" },
    viteClient: { status: 200, body: UNCONFIGURED_CLIENT },
  })).toEqual(["hmr-not-tunnel-ready"]);
});

test("HMR pointed at the wrong port is still not tunnel-ready", () => {
  const probe: Probe = {
    reachable: true,
    host: { status: 200, body: "ok" },
    viteClient: { status: 200, body: 'const socketProtocol = "wss";\nconst hmrPort = 24678;' },
  };
  expect(codes(probe)).toEqual(["hmr-not-tunnel-ready"]);
  expect(interpretProbe(probe, CTX)[0]!.message).toContain("port 24678");
});

test("the right port over the wrong protocol names the protocol, not the port", () => {
  const probe: Probe = {
    reachable: true,
    host: { status: 200, body: "ok" },
    viteClient: { status: 200, body: 'const socketProtocol = "ws";\nconst hmrPort = 443;' },
  };
  expect(codes(probe)).toEqual(["hmr-not-tunnel-ready"]);
  expect(interpretProbe(probe, CTX)[0]!.message).toContain("wss");
});

test("an unconfigured HMR port falls back to naming the dev port", () => {
  const probe: Probe = {
    reachable: true,
    host: { status: 200, body: "ok" },
    viteClient: { status: 200, body: UNCONFIGURED_CLIENT },
  };
  expect(interpretProbe(probe, CTX)[0]!.message).toContain("port 4101");
});

test("a non-Vite dev server skips HMR checks rather than failing them", () => {
  expect(codes({
    reachable: true,
    host: { status: 200, body: "ok" },
    viteClient: { status: 404, body: "Not Found" },
  })).toEqual(["unknown-dev-server"]);
});

test("a non-Vite dev server still gets the host check", () => {
  expect(codes({
    reachable: true,
    host: { status: 403, body: BLOCKED_BODY },
    viteClient: { status: 404, body: "Not Found" },
  })).toEqual(["host-blocked", "unknown-dev-server"]);
});

test("issues carry the exact config line to add", () => {
  const issues = interpretProbe({
    reachable: true,
    host: { status: 403, body: BLOCKED_BODY },
    viteClient: { status: 200, body: UNCONFIGURED_CLIENT },
  }, CTX);
  expect(issues[0]!.fix).toContain("server.allowedHosts: ['devapp.example.dev']");
  expect(issues[1]!.fix).toContain("clientPort: 443");
  expect(issues[1]!.fix).toContain("protocol: 'wss'");
});
