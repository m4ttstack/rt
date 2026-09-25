import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseDepsLock } from "../../../lib/bundle-layout.ts";
import { JQ_DIR, runJq } from "../../../rt-tray/vm/run/helpers/__tests__/jq.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const CATALOG_JQ = join(JQ_DIR, "catalog.jq");
const FIXTURE = join(import.meta.dir, "fixtures", "deps-lock-serve.fixture.json");
const SHIPPED_LOCK = join(ROOT, "rt-tray", "deps.lock");

interface CatalogApp { name: string; status: string; port: number; args: string[] }
interface Catalog { apps: CatalogApp[]; tools: string[] }

// jq sorts strings by codepoint; localeCompare would not agree on "git-lfs" vs "gitq".
const byCodepoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function viaJq(text: string): Catalog {
  return JSON.parse(runJq(["-c", "-f", CATALOG_JQ], text));
}

function viaParser(text: string): Catalog {
  const helpers = parseDepsLock(text).tools.filter((t) => t.kind === "helper");
  const apps: CatalogApp[] = [];
  const tools: string[] = [];
  for (const t of helpers) {
    if (t.serve) apps.push({ name: t.name, status: t.status, port: t.serve.port, args: [...t.serve.args] });
    else tools.push(t.name);
  }
  return { apps: apps.sort((a, b) => byCodepoint(a.name, b.name)), tools: tools.sort(byCodepoint) };
}

describe("catalog.jq agrees with parseDepsLock", () => {
  test("the shared serve fixture reads the same both ways, and names at least one app", () => {
    const text = JSON.stringify((JSON.parse(readFileSync(FIXTURE, "utf8")) as { lock: unknown }).lock);
    const catalog = viaJq(text);
    expect(catalog).toEqual(viaParser(text));
    expect(catalog.apps.length).toBeGreaterThan(0);
  });

  test("the shipped rt-tray/deps.lock reads the same both ways", () => {
    const text = readFileSync(SHIPPED_LOCK, "utf8");
    expect(viaJq(text)).toEqual(viaParser(text));
  });
});
