import { test, expect } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { personalSkillsDir } from "../../../lib/skills/writing-style-sources.ts";

const STUB = join(import.meta.dir, "stub.ts");

async function run(scenario: string, args: string[], stdin = "", stateDir?: string, extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", STUB, ...args], {
    env: { ...process.env, RT_STUB_SCENARIO: scenario, RT_STUB_STATE_DIR: stateDir ?? mkdtempSync(join(tmpdir(), "stub-")), ...extraEnv },
    stdin: new Blob([stdin]),
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, out, lines: out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
}

test("setup plan: join-happy is installable, perm-denied is not", async () => {
  const ok = await run("join-happy", ["setup", "plan", "--json"]);
  expect(ok.code).toBe(0);
  expect(ok.lines[0].contract).toBe(1);
  expect(ok.lines[0].canInstall).toBe(true);
  const denied = await run("perm-denied-then-granted", ["setup", "plan", "--json"]);
  expect(denied.lines[0].canInstall).toBe(false);
  expect(denied.lines[0].requiredMissing).toContain("perm.fda");
});

test("perm-denied-then-granted: plan flips to installable on the third call", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const first = await run("perm-denied-then-granted", ["setup", "plan", "--json"], "", state);
  const second = await run("perm-denied-then-granted", ["setup", "plan", "--json"], "", state);
  const third = await run("perm-denied-then-granted", ["setup", "plan", "--json"], "", state);
  expect(first.lines[0].canInstall).toBe(false);
  expect(second.lines[0].canInstall).toBe(false);
  expect(third.lines[0].canInstall).toBe(true);
});

test("team join --dry-run reads the code from stdin; no-access is exit 0 {access:'denied'} with a specific message", async () => {
  const happy = await run("join-happy", ["team", "join", "--dry-run", "--json"], JSON.stringify({ code: "ABCD-EFGH" }));
  expect(happy.code).toBe(0);
  expect(happy.lines[0].access).toBe("ok");
  expect(happy.lines[0].team.name).toBe("Acme");
  const denied = await run("join-no-access", ["team", "join", "--dry-run", "--json"], JSON.stringify({ code: "ABCD-EFGH" }));
  expect(denied.code).toBe(0);
  expect(denied.lines[0].access).toBe("denied");
  expect(denied.lines[0].message).toContain("ask");
  const malformed = await run("join-happy", ["team", "join", "--dry-run", "--json"], JSON.stringify({ code: "" }));
  expect(malformed.code).toBe(2);
  expect(malformed.lines[0].error.code).toBe("invite-malformed");
});

test("setup apply streams plan/step/need/done; apply-fail-retry fails once then succeeds with --from", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const first = await run("apply-fail-retry", ["setup", "apply", "--json"], "", state);
  const events = first.lines.map((e) => e.event);
  expect(events[0]).toBe("plan");
  expect(events).toContain("need");
  const done = first.lines.at(-1);
  expect(done.event).toBe("done");
  expect(done.ok).toBe(false);
  expect(done.failedStep).toBe("plugins.install");
  const retry = await run("apply-fail-retry", ["setup", "apply", "--from", "plugins.install", "--json"], "", state);
  expect(retry.lines[0].steps[0].id).toBe("plugins.install");
  expect(retry.lines.at(-1).ok).toBe(true);
});

test("uninstall --dry-run lists L1's action ids; --delete-data needs --yes; version build is numeric", async () => {
  const dry = await run("uninstall", ["uninstall", "--dry-run", "--json"]);
  expect(dry.lines[0].actions.map((a: { id: string }) => a.id)).toEqual(["deck.managed-remove", "services.unregister", "proxy.remove", "path.unlink", "shell.remove", "extension.uninstall", "plugins.uninstall", "app.trash"]);
  const dryDelete = await run("uninstall", ["uninstall", "--dry-run", "--delete-data", "--json"]);
  expect(dryDelete.lines[0].actions.map((a: { id: string }) => a.id)).toContain("data");
  const noYes = await run("uninstall", ["uninstall", "--delete-data", "--json"]);
  expect(noYes.code).toBe(2);
  expect(noYes.lines[0].error.code).toBe("confirm-required");
  const v = await run("join-happy", ["version", "--json"]);
  expect(v.lines[0].version).toBeDefined();
  expect(v.lines[0].build).toBe(0);
});

test("team status and setup github status answer the contract shapes", async () => {
  const ts = await run("join-happy", ["team", "status", "--json"]);
  expect(ts.lines[0].slug).toBe("acme");
  expect(ts.lines[0].members[0].username).toBe("matt");
  const gh = await run("join-happy", ["setup", "github", "status", "--json"]);
  expect(gh.lines[0].handle).toBe("matt");
  expect(gh.lines[0].owners).toContain("acme");
});

test("team create answers the contract's flat shape, not nested under team", async () => {
  const created = await run("join-happy", ["team", "create", "My Team", "--json"]);
  expect(created.code).toBe(0);
  expect(created.lines[0]).toMatchObject({ contract: 1, slug: "my-team", name: "My Team", created: true });
  expect(typeof created.lines[0].remote).toBe("string");
  expect((created.lines[0] as Record<string, unknown>).team).toBeUndefined();
});

test("uninstall real run's done event matches apply's shape with failedStep: null", async () => {
  const real = await run("uninstall", ["uninstall", "--json"]);
  expect(real.code).toBe(0);
  const done = real.lines.at(-1);
  expect(done.event).toBe("done");
  expect(done.ok).toBe(true);
  expect(done.failedStep).toBeNull();
});

test("restore scenario's apply stream starts at home.restore", async () => {
  const first = await run("restore", ["setup", "apply", "--json"]);
  expect(first.lines[0].event).toBe("plan");
  expect(first.lines[0].steps[0].id).toBe("home.restore");
  expect(first.lines[1].event).toBe("step");
  expect(first.lines[1].id).toBe("home.restore");
});

test("uninstall real run streams every v1 action id, the two need events, and honours --delete-data", async () => {
  const keep = await run("uninstall", ["uninstall", "--keep-data", "--yes", "--json"]);
  expect(keep.lines[0].event).toBe("plan");
  expect(keep.lines[0].steps.map((s: { id: string }) => s.id)).toEqual(["deck.managed-remove", "services.unregister", "proxy.remove", "path.unlink", "shell.remove", "extension.uninstall", "plugins.uninstall", "app.trash"]);
  const needs = keep.lines.filter((l: { event: string }) => l.event === "need");
  expect(needs.map((n: { id: string }) => n.id)).toEqual(["services.unregister", "proxy.remove"]);
  expect(needs[0].request.type).toBe("app-unregister-services");
  expect(needs[0].request.plists).toContain("com.mattstack.daemon.plist");
  expect(needs[1].request).toEqual({ type: "app-privileged", op: "proxy-remove" });
  expect(keep.lines.some((l: { id: string }) => l.id === "data")).toBe(false);

  const del = await run("uninstall", ["uninstall", "--delete-data", "--yes", "--json"]);
  expect(del.lines[0].steps.map((s: { id: string }) => s.id)).toContain("data");
  expect(del.lines.at(-1)).toMatchObject({ event: "done", ok: true });
});

// The finish-gate scenario's shape is a contract with
// mattstackUITests.testFinishGateSkipForNowEnablesFinish.
const EXTENSION = "tool.fast-browser-extension";
const WAIVED_NOTE = "Skipped on this Mac: agents cannot capture screenshots or annotate evidence from your browser. Load it later from Settings.";
const extensionRow = (plan: { groups: { rows: Record<string, unknown>[] }[] }) => plan.groups.flatMap((g) => g.rows).find((r) => r.id === EXTENSION);

test("finish-gate: the extension row blocks Finish, waive moves it to waived, unwaive re-arms it", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const first = await run("finish-gate", ["setup", "plan", "--json"], "", state);
  expect(first.code).toBe(0);
  expect(first.lines[0].canInstall).toBe(true);
  expect(first.lines[0].finishBlockedBy).toEqual([EXTENSION]);
  const row = extensionRow(first.lines[0])!;
  expect(row.status).toBe("needs-you");
  expect(row.finishGated).toBe(true);
  expect(row.waived).toBe(false);
  expect(row.required).toBe(false);
  expect((row.action as { type: string }).type).toBe("steps");

  const waive = await run("finish-gate", ["setup", "waive", EXTENSION, "--json"], "", state);
  expect(waive.code).toBe(0);
  expect(waive.lines[0]).toMatchObject({ ok: true, id: EXTENSION, waived: [EXTENSION] });

  const second = await run("finish-gate", ["setup", "plan", "--json"], "", state);
  expect(second.lines[0].finishBlockedBy).toEqual([]);
  const waived = extensionRow(second.lines[0])!;
  expect(waived.waived).toBe(true);
  expect(waived.required).toBe(false);
  expect(waived.status).toBe("needs-you");
  expect(waived.optionalNote).toBe(WAIVED_NOTE);

  const unwaive = await run("finish-gate", ["setup", "unwaive", EXTENSION, "--json"], "", state);
  expect(unwaive.lines[0].waived).toEqual([]);
  const third = await run("finish-gate", ["setup", "plan", "--json"], "", state);
  expect(third.lines[0].finishBlockedBy).toEqual([EXTENSION]);
  expect(extensionRow(third.lines[0])!.waived).toBe(false);
});

test("finish-gate: waive refuses a row that is not finish-gated with the contract's exit-2 envelope", async () => {
  const res = await run("finish-gate", ["setup", "waive", "tool.chrome", "--json"]);
  expect(res.code).toBe(2);
  expect(res.lines[0].error.code).toBe("not-finish-gated");
});

test("every other scenario keeps an open gate and no extension row", async () => {
  for (const scenario of ["join-happy", "create-happy", "perm-denied-then-granted"]) {
    const res = await run(scenario, ["setup", "plan", "--json"]);
    expect(res.lines[0].finishBlockedBy).toEqual([]);
    expect(extensionRow(res.lines[0])).toBeUndefined();
    expect(writingStyleRow(res.lines[0])).toBeUndefined();
  }
});

// The writing-style scenario feeds the ChooseSheet walkthrough on the
// checklist, Done and Settings.
const WRITING_STYLE = "skills.writing-style";
const SPARSE = "mattstack:writing-style-sparse";
const writingStyleRow = (plan: { groups: { rows: Record<string, unknown>[] }[] }) => plan.groups.flatMap((g) => g.rows).find((r) => r.id === WRITING_STYLE);
type ChooseAction = {
  type: string; verb: string[]; selected?: string; subtitle: string; footnote: string;
  options: { id: string; label: string; detail: string; sample?: string }[];
  other: { label: string; hint: string; suggestions: string[] };
};
const CHOOSE_SUBTITLE = "The voice agents use for reviews, replies and PR descriptions posted under your name.";
const CHOOSE_FOOTNOTE = "You can also choose from a terminal: rt skills writing-style use";

test("writing-style: the row blocks Finish with a choose action until use picks a style", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const first = await run("writing-style", ["setup", "plan", "--json"], "", state);
  expect(first.code).toBe(0);
  expect(first.lines[0].canInstall).toBe(true);
  expect(first.lines[0].finishBlockedBy).toEqual([WRITING_STYLE]);
  const row = writingStyleRow(first.lines[0])!;
  expect(row).toMatchObject({ kind: "tool", status: "needs-you", detail: "Not chosen yet", required: false, finishGated: true, waivable: false });
  const action = row.action as ChooseAction;
  expect(action.type).toBe("choose");
  expect(action.verb).toEqual(["skills", "writing-style", "use"]);
  expect(action.selected).toBeUndefined();
  expect(action.subtitle).toBe(CHOOSE_SUBTITLE);
  expect(action.footnote).toBe(CHOOSE_FOOTNOTE);
  expect(action.options.map((o) => o.id)).toEqual([SPARSE, "mattstack:writing-style-conversational", "mattstack:writing-style-structured"]);
  expect(action.options.filter((o) => o.sample).map((o) => o.id)).toEqual([SPARSE, "mattstack:writing-style-conversational", "mattstack:writing-style-structured"]);
  expect(action.other).toEqual({
    label: "Use my own skill…", hint: "Any installed skill id. Start one with rt skills writing-style new.",
    suggestions: ["acme:review-voice", "acme:team-writing-style", "superpowers:brainstorming", "superpowers:writing-plans", "team-voice", "team:team-writing-style"],
  });

  const used = await run("writing-style", ["skills", "writing-style", "use", SPARSE, "--json"], "", state);
  expect(used.code).toBe(0);
  expect(used.lines[0]).toMatchObject({ contract: 1, skill: SPARSE, scope: "user" });

  const second = await run("writing-style", ["setup", "plan", "--json"], "", state);
  expect(second.lines[0].finishBlockedBy).toEqual([]);
  const ready = writingStyleRow(second.lines[0])!;
  expect(ready).toMatchObject({ status: "ready", detail: "Sparse (yours)" });
  expect((ready.action as ChooseAction).selected).toBe(SPARSE);
});

test("writing-style: use refuses a bad id and an unknown skill with exit 2 and changes nothing; an own skill id is accepted", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const bad = await run("writing-style", ["skills", "writing-style", "use", "-rf", "--json"], "", state);
  expect(bad.code).toBe(2);
  expect(bad.lines[0].error).toEqual({ code: "bad-id", message: "\"-rf\" is not a skill id" });
  const unknown = await run("writing-style", ["skills", "writing-style", "use", "not-installed", "--json"], "", state);
  expect(unknown.code).toBe(2);
  expect(unknown.lines[0].error.code).toBe("unknown-skill");
  expect(unknown.lines[0].error.message).toStartWith("not-installed is not installed here. Choose one of: ");
  const still = await run("writing-style", ["setup", "plan", "--json"], "", state);
  expect(still.lines[0].finishBlockedBy).toEqual([WRITING_STYLE]);

  const own = await run("writing-style", ["skills", "writing-style", "use", "team-voice", "--json"], "", state);
  expect(own.code).toBe(0);
  const after = await run("writing-style", ["setup", "plan", "--json"], "", state);
  const ready = writingStyleRow(after.lines[0])!;
  expect(ready).toMatchObject({ status: "ready", detail: "team-voice (yours)" });
  expect((ready.action as ChooseAction).selected).toBe("team-voice");
});

// RT_STUB_REAL_WRITING_STYLE=1 judges the picker against the operator's real
// skills, read through the same lib/skills code the app ships with, against a
// fixture home only; it must never touch the real machine or write anywhere.
function buildRealFixture(): { home: string; claudeBin: string } {
  const home = mkdtempSync(join(tmpdir(), "stub-real-home-"));

  const personalDir = join(personalSkillsDir(home), "team-voice");
  mkdirSync(personalDir, { recursive: true });
  writeFileSync(join(personalDir, "SKILL.md"), "---\nname: team-voice\ndescription: personal voice\n---\nbody\n");

  const claudeSkillsDir = join(home, ".claude", "skills", "x:custom-note");
  mkdirSync(claudeSkillsDir, { recursive: true });
  writeFileSync(join(claudeSkillsDir, "SKILL.md"), "---\nname: x:custom-note\ndescription: not a writing style\n---\nbody\n");

  const pluginInstallPath = join(home, "plugins", "acme");
  mkdirSync(join(pluginInstallPath, ".claude-plugin"), { recursive: true });
  writeFileSync(join(pluginInstallPath, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version: "1.0.0" }));
  const pluginSkillDir = join(pluginInstallPath, "skills", "team-writing-style");
  mkdirSync(pluginSkillDir, { recursive: true });
  writeFileSync(join(pluginSkillDir, "SKILL.md"), "---\nname: team-writing-style\ndescription: acme's team voice\n---\nbody\n");

  const claudeBin = join(home, "fixture-claude");
  writeFileSync(claudeBin, [
    "#!/usr/bin/env bun",
    `console.log(JSON.stringify([{ id: "acme@marketplace", enabled: true, installPath: ${JSON.stringify(pluginInstallPath)} }]));`,
    "",
  ].join("\n"));
  chmodSync(claudeBin, 0o755);

  return { home, claudeBin };
}

function snapshotTree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, prefix: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const st = statSync(full);
      if (st.isDirectory()) walk(full, rel);
      else out.push(`${rel}:${st.size}:${st.mtimeMs}`);
    }
  };
  walk(dir, "");
  return out;
}

// Each call below is a fresh stub process that itself spawns the fixture
// claude binary, so the cold starts stack up; a generous timeout keeps this
// from flaking under load rather than proving anything about the code.
test("writing-style real-data mode: options and suggestions come from the fixture home, use accepts a fixture id and rejects an unknown one, a chosen personal style reads ready, and nothing is written", async () => {
  const { home, claudeBin } = buildRealFixture();
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const extraEnv = { RT_STUB_REAL_WRITING_STYLE: "1", RT_STUB_REAL_HOME: home, RT_STUB_CLAUDE_BIN: claudeBin };
  const before = snapshotTree(home);

  const first = await run("writing-style", ["setup", "plan", "--json"], "", state, extraEnv);
  expect(first.code).toBe(0);
  const row = writingStyleRow(first.lines[0])!;
  expect(row).toMatchObject({ status: "needs-you", detail: "Not chosen yet", finishGated: true, waivable: false });
  const action = row.action as ChooseAction;
  const ids = action.options.map((o) => o.id);
  expect(ids).toEqual([SPARSE, "mattstack:writing-style-conversational", "mattstack:writing-style-structured"]);
  expect(action.other.suggestions).toContain("x:custom-note");
  expect(action.other.suggestions).toContain("acme:team-writing-style");
  expect(action.other.suggestions).toContain("team-voice");

  const badShape = await run("writing-style", ["skills", "writing-style", "use", "-rf", "--json"], "", state, extraEnv);
  expect(badShape.code).toBe(2);
  expect(badShape.lines[0].error.code).toBe("bad-id");

  const unknown = await run("writing-style", ["skills", "writing-style", "use", "nobody:not-real", "--json"], "", state, extraEnv);
  expect(unknown.code).toBe(2);
  expect(unknown.lines[0].error.code).toBe("unknown-skill");

  const used = await run("writing-style", ["skills", "writing-style", "use", "team-voice", "--json"], "", state, extraEnv);
  expect(used.code).toBe(0);
  expect(used.lines[0]).toMatchObject({ skill: "team-voice", scope: "user" });

  // Real rt's `use` links a chosen personal skill before returning; this mode
  // never writes to realHome, so the row must still read ready off the
  // in-memory installed set, not off a symlink that was never created.
  const afterUse = await run("writing-style", ["setup", "plan", "--json"], "", state, extraEnv);
  const readyRow = writingStyleRow(afterUse.lines[0])!;
  expect(readyRow).toMatchObject({ status: "ready", detail: "team-voice (yours)" });
  expect((readyRow.action as ChooseAction).selected).toBe("team-voice");

  expect(snapshotTree(home)).toEqual(before);
}, 20000);

test("writing-style real-data mode requires RT_STUB_REAL_HOME: unset or non-existent fails loudly naming it", async () => {
  const unset = await run("writing-style", ["setup", "plan", "--json"], "", undefined, { RT_STUB_REAL_WRITING_STYLE: "1" });
  expect(unset.code).toBe(2);
  expect(unset.lines[0].error.code).toBe("no-real-home");
  expect(unset.lines[0].error.message).toContain("RT_STUB_REAL_HOME");

  const missing = join(tmpdir(), `stub-real-home-missing-${Date.now()}`);
  const notADir = await run("writing-style", ["setup", "plan", "--json"], "", undefined, {
    RT_STUB_REAL_WRITING_STYLE: "1", RT_STUB_REAL_HOME: missing,
  });
  expect(notADir.code).toBe(2);
  expect(notADir.lines[0].error.code).toBe("no-real-home");
});

test("every other scenario ignores RT_STUB_REAL_WRITING_STYLE (only the writing-style scenario reads it)", async () => {
  const { home, claudeBin } = buildRealFixture();
  const extraEnv = { RT_STUB_REAL_WRITING_STYLE: "1", RT_STUB_REAL_HOME: home, RT_STUB_CLAUDE_BIN: claudeBin };
  const res = await run("join-happy", ["setup", "plan", "--json"], "", undefined, extraEnv);
  expect(writingStyleRow(res.lines[0])).toBeUndefined();
});
