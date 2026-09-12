import { beforeEach, describe, expect, test } from "bun:test";
import { setupUnwaive, setupWaive, type WaiveDeps } from "../setup.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";

class ExitSentinel extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

function deps(overrides: Partial<WaiveDeps> & { initial?: string[] } = {}) {
  const lines: string[] = [];
  const errors: string[] = [];
  const writes: string[][] = [];
  let ids = overrides.initial ?? [];
  let picked: { message: string; options: string[] } | null = null;
  const { initial: _initial, ...rest } = overrides;
  const d: WaiveDeps = {
    probes: fakeProbes(),
    store: {
      read: () => ids,
      write: (next) => {
        writes.push(next);
        ids = next;
      },
    },
    print: (s) => lines.push(s),
    printError: (s) => errors.push(s),
    exit: (code) => {
      throw new ExitSentinel(code);
    },
    isTTY: () => false,
    pick: async (message, options) => {
      picked = { message, options };
      return null;
    },
    ...rest,
  };
  return { d, lines, errors, writes, picked: () => picked };
}

async function exitCode(fn: () => Promise<void>): Promise<number | undefined> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    if (err instanceof ExitSentinel) return err.code;
    throw err;
  }
}

beforeEach(() => {
  delete process.env.RT_BATCH;
});

describe("rt setup waive", () => {
  test("--json writes the id at machine scope and prints an ok envelope", async () => {
    const t = deps();
    await setupWaive(["tool.fast-browser-extension", "--json"], {}, t.d);
    expect(t.writes).toEqual([["tool.fast-browser-extension"]]);
    expect(t.lines).toHaveLength(1);
    const body = JSON.parse(t.lines[0]!);
    expect(body.contract).toBe(1);
    expect(body.ok).toBe(true);
    expect(body.id).toBe("tool.fast-browser-extension");
    expect(body.waived).toEqual(["tool.fast-browser-extension"]);
  });

  test("human mode prints one line", async () => {
    const t = deps();
    await setupWaive(["tool.fast-browser-extension"], {}, t.d);
    expect(t.lines).toEqual(["setup waive: tool.fast-browser-extension skipped on this Mac"]);
  });

  test("an id that is not finish-gated exits 2 with the error envelope and writes nothing", async () => {
    const t = deps();
    expect(await exitCode(() => setupWaive(["tool.chrome", "--json"], {}, t.d))).toBe(2);
    expect(t.writes).toEqual([]);
    const body = JSON.parse(t.lines[0]!);
    expect(body.error.code).toBe("not-finish-gated");
    expect(body.error.message).toContain("tool.fast-browser-extension");
  });

  test("no id off a TTY exits 2 with usage, never a picker", async () => {
    const t = deps();
    expect(await exitCode(() => setupWaive([], {}, t.d))).toBe(2);
    expect(t.lines[0]).toBe("rt setup waive: usage: rt setup waive <row-id> [--json]");
    expect(t.picked()).toBeNull();
  });

  test("no id on a TTY offers a picker over the finish-gated rows; cancel exits 0", async () => {
    const t = deps({ isTTY: () => true });
    expect(await exitCode(() => setupWaive([], {}, t.d))).toBe(0);
    expect(t.picked()?.options).toEqual(["tool.fast-browser-extension"]);
    expect(t.writes).toEqual([]);
  });

  test("a picked id is waived like a typed one", async () => {
    const t = deps({ isTTY: () => true, pick: async () => "tool.fast-browser-extension" });
    await setupWaive([], {}, t.d);
    expect(t.writes).toEqual([["tool.fast-browser-extension"]]);
  });

  test("--json on a TTY never opens the picker", async () => {
    const t = deps({ isTTY: () => true });
    expect(await exitCode(() => setupWaive(["--json"], {}, t.d))).toBe(2);
    expect(t.picked()).toBeNull();
  });

  test("RT_BATCH on a TTY never opens the picker", async () => {
    process.env.RT_BATCH = "1";
    const t = deps({ isTTY: () => true });
    expect(await exitCode(() => setupWaive([], {}, t.d))).toBe(2);
    expect(t.picked()).toBeNull();
  });

  test("a store write failure surfaces the resolver's message on stderr and exits 1", async () => {
    const t = deps({
      store: {
        read: () => [],
        write: () => {
          throw new Error("settings.local.jsonc: duplicate key");
        },
      },
    });
    expect(await exitCode(() => setupWaive(["tool.fast-browser-extension", "--json"], {}, t.d))).toBe(1);
    expect(t.lines).toEqual([]);
    expect(t.errors).toEqual(["rt setup waive: settings.local.jsonc: duplicate key"]);
  });
});

describe("rt setup unwaive", () => {
  test("removes the id and prints the remaining list", async () => {
    const t = deps({ initial: ["tool.fast-browser-extension"] });
    await setupUnwaive(["tool.fast-browser-extension", "--json"], {}, t.d);
    expect(t.writes).toEqual([[]]);
    expect(JSON.parse(t.lines[0]!).waived).toEqual([]);
  });

  test("human mode prints one line", async () => {
    const t = deps({ initial: ["tool.fast-browser-extension"] });
    await setupUnwaive(["tool.fast-browser-extension"], {}, t.d);
    expect(t.lines).toEqual(["setup unwaive: tool.fast-browser-extension re-armed on this Mac"]);
  });

  test("an id that is not finish-gated exits 2", async () => {
    const t = deps();
    expect(await exitCode(() => setupUnwaive(["tool.chrome"], {}, t.d))).toBe(2);
    expect(t.lines[0]).toStartWith("rt setup unwaive: ");
  });
});
