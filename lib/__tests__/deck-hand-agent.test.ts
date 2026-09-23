import { describe, expect, test } from "bun:test";
import {
  HAND_DECK_LABEL,
  handDeckPlistPath,
  retiredHandDeckPlistPath,
  retireHandInstalledDeckAgent,
  type HandDeckAgentSeams,
} from "../deck-hand-agent.ts";

const HOME = "/Users/tester";
const UID = 501;
const PLIST = `${HOME}/Library/LaunchAgents/com.mattstack.deck.plist`;
const RETIRED = `${HOME}/.mattstack/deck/com.mattstack.deck.plist.retired`;

const HAND_PRINT = `gui/501/com.mattstack.deck = {\n\tactive count = 1\n\tpath = ${PLIST}\n\ttype = LaunchAgent\n\tstate = running\n}`;
const SMD_PRINT = `gui/501/com.mattstack.deck = {\n\tactive count = 1\n\tpath = (submitted by smd.340)\n\ttype = Submitted\n\tmanaged_by = com.apple.xpc.ServiceManagement\n}`;
const NOT_LOADED = { status: 113, stdout: "Could not find service \"com.mattstack.deck\" in domain for user gui: 501\n" };

interface Fake extends HandDeckAgentSeams {
  files: Set<string>;
  launchctlCalls: string[][];
  renames: Array<[string, string]>;
  mkdirs: string[];
}

function fake(opts: {
  files?: string[];
  print?: { status: number; stdout: string };
  bootout?: { status: number; stdout: string };
  renameThrows?: boolean;
}): Fake {
  const files = new Set(opts.files ?? []);
  const f: Fake = {
    home: HOME,
    uid: UID,
    files,
    launchctlCalls: [],
    renames: [],
    mkdirs: [],
    exists: (p) => files.has(p),
    launchctl(args) {
      f.launchctlCalls.push(args);
      if (args[0] === "print") return opts.print ?? NOT_LOADED;
      if (args[0] === "bootout") return opts.bootout ?? { status: 0, stdout: "" };
      throw new Error(`unexpected launchctl ${args.join(" ")}`);
    },
    mkdirp(dir) {
      f.mkdirs.push(dir);
    },
    rename(from, to) {
      if (opts.renameThrows) throw new Error("EPERM");
      f.renames.push([from, to]);
      files.delete(from);
      files.add(to);
    },
  };
  return f;
}

describe("retireHandInstalledDeckAgent", () => {
  test("paths: the hand plist lives in ~/Library/LaunchAgents and archives under ~/.mattstack/deck", () => {
    expect(HAND_DECK_LABEL).toBe("com.mattstack.deck");
    expect(handDeckPlistPath(HOME)).toBe(PLIST);
    expect(retiredHandDeckPlistPath(HOME)).toBe(RETIRED);
  });

  test("no hand plist: nothing is touched, not even launchctl print (the label may belong to the prod bundle helper)", () => {
    const f = fake({ print: { status: 0, stdout: SMD_PRINT } });
    expect(retireHandInstalledDeckAgent(f)).toEqual({ kind: "absent" });
    expect(f.launchctlCalls).toEqual([]);
    expect(f.renames).toEqual([]);
  });

  test("a loaded hand agent is booted out, then its plist is archived", () => {
    const f = fake({ files: [PLIST], print: { status: 0, stdout: HAND_PRINT } });
    expect(retireHandInstalledDeckAgent(f)).toEqual({ kind: "retired", bootedOut: true, archivedTo: RETIRED });
    expect(f.launchctlCalls).toEqual([
      ["print", "gui/501/com.mattstack.deck"],
      ["bootout", "gui/501/com.mattstack.deck"],
    ]);
    expect(f.mkdirs).toEqual([`${HOME}/.mattstack/deck`]);
    expect(f.renames).toEqual([[PLIST, RETIRED]]);
  });

  test("an unloaded hand plist is archived without a bootout", () => {
    const f = fake({ files: [PLIST], print: NOT_LOADED });
    expect(retireHandInstalledDeckAgent(f)).toEqual({ kind: "retired", bootedOut: false, archivedTo: RETIRED });
    expect(f.launchctlCalls).toEqual([["print", "gui/501/com.mattstack.deck"]]);
    expect(f.renames).toEqual([[PLIST, RETIRED]]);
  });

  test("the label loaded by SMAppService (prod bundle helper) is never booted out; the stray plist is still archived", () => {
    const f = fake({ files: [PLIST], print: { status: 0, stdout: SMD_PRINT } });
    expect(retireHandInstalledDeckAgent(f)).toEqual({ kind: "retired", bootedOut: false, archivedTo: RETIRED });
    expect(f.launchctlCalls.some((a) => a[0] === "bootout")).toBe(false);
    expect(f.renames).toEqual([[PLIST, RETIRED]]);
  });

  test("a failed bootout leaves the plist in place and reports failure", () => {
    const f = fake({ files: [PLIST], print: { status: 0, stdout: HAND_PRINT }, bootout: { status: 5, stdout: "Boot-out failed: 5: Input/output error" } });
    const out = retireHandInstalledDeckAgent(f);
    expect(out.kind).toBe("failed");
    expect(out.kind === "failed" && out.error).toContain("Input/output error");
    expect(f.renames).toEqual([]);
  });

  test("an existing archive is never clobbered: the new one takes a timestamped name", () => {
    const f = fake({ files: [PLIST, RETIRED], print: NOT_LOADED });
    f.now = () => 1_700_000_000_000;
    const out = retireHandInstalledDeckAgent(f);
    expect(out).toEqual({ kind: "retired", bootedOut: false, archivedTo: `${RETIRED}.1700000000000` });
    expect(f.files.has(RETIRED)).toBe(true);
  });

  test("a failed archive move reports failure after the bootout", () => {
    const f = fake({ files: [PLIST], print: { status: 0, stdout: HAND_PRINT }, renameThrows: true });
    const out = retireHandInstalledDeckAgent(f);
    expect(out.kind).toBe("failed");
    expect(out.kind === "failed" && out.error).toContain("EPERM");
  });
});
