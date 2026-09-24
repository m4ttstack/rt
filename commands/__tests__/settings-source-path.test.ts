import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deleteKvValue, getKvValue } from "../../lib/state/index.ts";
import { sourcePathCommand } from "../settings.ts";

const HOME = process.env.HOME!;
const RT_LINK = join(HOME, ".local", "bin", "rt");
const dirs: string[] = [];

function checkout(): string {
  const dir = mkdtempSync(join(tmpdir(), "rt-source-path-"));
  writeFileSync(join(dir, "cli.ts"), "");
  dirs.push(dir);
  return dir;
}

async function run(args: string[]): Promise<{ out: string[]; err: string[]; exitCode: number | null }> {
  const r = { out: [] as string[], err: [] as string[], exitCode: null as number | null };
  await sourcePathCommand(args, {}, {
    log: (l) => r.out.push(l),
    error: (l) => r.err.push(l),
    exit: ((code: number) => { r.exitCode = code; }) as unknown as (code: number) => never,
  });
  return r;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  rmSync(RT_LINK, { force: true });
  try { deleteKvValue("dev-mode", "config"); } catch { /* never opened */ }
});

describe("rt settings source-path", () => {
  test("unset reads as null", async () => {
    const r = await run(["--json"]);
    expect(JSON.parse(r.out.join("\n")).sourcePath).toBeNull();
  });

  test("setting a checkout stores it where the dev daemon launcher reads it", async () => {
    const src = checkout();
    const r = await run([src]);
    expect(r.exitCode).toBeNull();
    expect(getKvValue<{ sourcePath?: string }>("dev-mode", "config", {}).sourcePath).toBe(src);
    expect(JSON.parse((await run(["--json"])).out.join("\n")).sourcePath).toBe(src);
  });

  test("a directory without cli.ts is refused and nothing is stored", async () => {
    const notRt = mkdtempSync(join(tmpdir(), "rt-source-path-bad-"));
    dirs.push(notRt);
    const r = await run([notRt]);
    expect(r.exitCode).toBe(2);
    expect(getKvValue<{ sourcePath?: string }>("dev-mode", "config", {}).sourcePath).toBeUndefined();
  });

  test("while the dev wrapper owns ~/.local/bin/rt, it is rewritten to run the new checkout", async () => {
    const first = checkout();
    await run([first]);
    mkdirSync(dirname(RT_LINK), { recursive: true });
    writeFileSync(RT_LINK, `#!/bin/zsh\n# mattstack-dev-mode\nexec bun "${first}/cli.ts"\n`, { mode: 0o755 });
    const second = checkout();

    await run([second]);

    expect(readFileSync(RT_LINK, "utf8")).toContain(`"${second}/cli.ts"`);
  });

  test("the prod app's link is left alone", async () => {
    const bundleRt = join(checkout(), "rt");
    writeFileSync(bundleRt, Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), { mode: 0o755 });
    mkdirSync(dirname(RT_LINK), { recursive: true });
    symlinkSync(bundleRt, RT_LINK);

    await run([checkout()]);

    expect(existsSync(RT_LINK)).toBe(true);
    expect(readFileSync(RT_LINK)).toEqual(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
  });
});
