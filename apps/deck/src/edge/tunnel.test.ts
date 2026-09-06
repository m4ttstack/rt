import { expect, test } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CloudflaredCli, FakeTunnelDriver, renderTunnelConfig, writeTunnelConfig } from "./tunnel.ts";

type Call = { argv: string[] };
function cli(responses: Record<string, { code?: number; stdout?: string; stderr?: string }>) {
  const calls: Call[] = [];
  const exec = async (argv: string[]) => {
    calls.push({ argv });
    const key = argv.slice(1, 3).join(" ");
    const r = responses[key] ?? {};
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return { driver: new CloudflaredCli(exec), calls };
}

// Shapes observed on cloudflared 2026.5.0: list emits [{id,name,created_at,deleted_at,connections:[...]}],
// info emits {id,name,createdAt,conns:[...]} and takes its flags BEFORE the name argument.
test("list parses tunnel list -o json into name/uuid/connections", async () => {
  const { driver, calls } = cli({
    "tunnel list": { stdout: JSON.stringify([
      { id: "u-1", name: "deck-edge-mbp-abc123", created_at: "x", deleted_at: "0001-01-01T00:00:00Z", connections: [{ id: "c1" }, { id: "c2" }] },
      { id: "u-2", name: "other", created_at: "x", deleted_at: "0001-01-01T00:00:00Z", connections: [] },
    ]) },
  });
  expect(await driver.list()).toEqual([
    { name: "deck-edge-mbp-abc123", uuid: "u-1", connections: 2 },
    { name: "other", uuid: "u-2", connections: 0 },
  ]);
  expect(calls[0]!.argv.slice(1)).toEqual(["tunnel", "list", "-o", "json"]);
});

test("info parses connector count and puts -o json before the name", async () => {
  const { driver, calls } = cli({ "tunnel info": { stdout: JSON.stringify({ id: "u-1", name: "n", conns: [{ id: "a" }, { id: "b" }, { id: "c" }] }) } });
  expect(await driver.info("n")).toEqual({ connectors: 3 });
  expect(calls[0]!.argv.slice(1)).toEqual(["tunnel", "info", "-o", "json", "n"]);
});

test("delete forces, because edge connections linger after the service stops", async () => {
  const { driver, calls } = cli({});
  await driver.delete("n");
  expect(calls[0]!.argv.slice(1)).toEqual(["tunnel", "delete", "-f", "n"]);
});

test("create reads the uuid from stdout or stderr", async () => {
  const { driver } = cli({ "tunnel create": { stderr: "Created tunnel n with id 0f2f1c9e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" } });
  expect(await driver.create("n")).toEqual({ uuid: "0f2f1c9e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" });
});

test("renderTunnelConfig is the exact spec shape with metrics pinned", () => {
  expect(renderTunnelConfig({ uuid: "u-1", credentialsFile: "/c/u-1.json", domain: "example.dev", gatewayPort: 7950, metricsPort: 7951 })).toBe(
`tunnel: u-1
credentials-file: /c/u-1.json
metrics: 127.0.0.1:7951

ingress:
  - hostname: "*.example.dev"
    service: http://localhost:7950
  - service: http_status:404
`);
});

test("writeTunnelConfig creates parent dirs and writes the rendered file", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunnel-cfg-"));
  const path = join(dir, "nested", "tunnel.yml");
  writeTunnelConfig(path, { uuid: "u", credentialsFile: "/c/u.json", domain: "e.dev", gatewayPort: 1, metricsPort: 2 });
  expect(readFileSync(path, "utf8")).toContain("hostname: \"*.e.dev\"");
});

test("FakeTunnelDriver tracks tunnels, mints uuids and writes creds when given a dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunnel-fake-"));
  const fake = new FakeTunnelDriver(dir);
  const { uuid } = await fake.create("n");
  expect(existsSync(join(dir, `${uuid}.json`))).toBe(true);
  expect(await fake.list()).toEqual([{ name: "n", uuid, connections: 0 }]);
  await fake.delete("n");
  expect(await fake.list()).toEqual([]);
  expect(fake.calls).toEqual([["create", "n"], ["list"], ["delete", "n"], ["list"]]);
});
