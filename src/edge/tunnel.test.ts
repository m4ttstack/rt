// src/edge/tunnel.test.ts
import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CloudflaredCli, FakeTunnelDriver, writeTunnelConfig } from "./tunnel.ts";

const dir = mkdtempSync(join(tmpdir(), "local-tunnel-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("create parses the tunnel UUID from cloudflared output", async () => {
  const cli = new CloudflaredCli(async () => ({
    code: 0,
    stdout: "Tunnel credentials written to /Users/x/.cloudflared/9f1c2a34-1111-2222-3333-abcdefabcdef.json\nCreated tunnel local-edge with id 9f1c2a34-1111-2222-3333-abcdefabcdef\n",
  }));
  expect(await cli.create("local-edge")).toEqual({ uuid: "9f1c2a34-1111-2222-3333-abcdefabcdef" });
});

test("routeDns shells the wildcard route", async () => {
  const calls: string[][] = [];
  const cli = new CloudflaredCli(async (argv) => { calls.push(argv); return { code: 0, stdout: "" }; });
  await cli.routeDns("local-edge", "*.example.dev");
  expect(calls[0]!.slice(1)).toEqual(["tunnel", "route", "dns", "local-edge", "*.example.dev"]);
});

test("writeTunnelConfig renders the wildcard ingress at the gateway", () => {
  const path = writeTunnelConfig({
    name: "local-edge", uuid: "u-1", domain: "example.dev", gatewayPort: 7950, cloudflaredDir: dir,
  });
  const yml = readFileSync(path, "utf8");
  expect(yml).toContain("tunnel: u-1");
  expect(yml).toContain(`credentials-file: ${join(dir, "u-1.json")}`);
  expect(yml).toContain('hostname: "*.example.dev"');
  expect(yml).toContain("service: http://localhost:7950");
  expect(yml).toContain("service: http_status:404");
});

test("fake records the flow", async () => {
  const fake = new FakeTunnelDriver();
  await fake.create("t");
  await fake.routeDns("t", "*.d.dev");
  expect(fake.calls).toEqual([["create", "t"], ["routeDns", "t", "*.d.dev"]]);
});
