import { describe, expect, test } from "bun:test";
import { join } from "path";
import type { TeamRef } from "../contract.ts";
import { repoRootRow } from "../validators/repo-root.ts";
import { stageRepoRoot } from "../repo-root.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import type { TeamSnapshot } from "../team-settings.ts";
import { fakeProbes } from "./fakes.ts";

const HOME = "/Users/t";
const DIR = { isDirectory: true, writable: true };

function team(overrides: Partial<TeamRef> = {}): TeamRef {
  return { slug: "acme", name: "Acme", mode: "none", ...overrides };
}

function snapshot(overrides: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return { slug: "acme", integrations: {}, trackingIdentities: [], marketplaces: [], plugins: [], remote: null, ...overrides };
}

/** Every test starts from "nothing configured" so cross-file pollution of the real rt.repoRoots setting can never leak a stale value in. */
function clearConfiguredRoot(): void {
  setSetting("rt.repoRoots", [], "machine");
}

describe("repoRootRow: render gate", () => {
  test("absent when team.mode is none and trackingIdentities is empty", () => {
    clearConfiguredRoot();
    expect(repoRootRow(fakeProbes({ home: HOME }), team({ mode: "none" }), snapshot())).toBeNull();
  });

  test("absent when team.mode is create and trackingIdentities is empty", () => {
    clearConfiguredRoot();
    expect(repoRootRow(fakeProbes({ home: HOME }), team({ mode: "create" }), snapshot())).toBeNull();
  });

  // The joiner's first pass: the team clone (and so trackingIdentities) does
  // not exist until team.join runs inside Install. A row gated on tracking
  // alone would not render here, canInstall would go true, and Install would
  // clone zero repos.
  test("present when team.mode is join and trackingIdentities is EMPTY", () => {
    clearConfiguredRoot();
    const r = repoRootRow(fakeProbes({ home: HOME }), team({ mode: "join" }), snapshot({ trackingIdentities: [] }));
    expect(r).not.toBeNull();
    expect(r!.id).toBe("repos.root");
  });

  test("present when mode is none but trackingIdentities is non-empty (post-install)", () => {
    clearConfiguredRoot();
    const r = repoRootRow(fakeProbes({ home: HOME }), team({ mode: "none" }), snapshot({ trackingIdentities: ["gitlab.com/acme/one"] }));
    expect(r).not.toBeNull();
  });
});

describe("repoRootRow: resolution", () => {
  test("nothing set and nothing staged -> needs-you, required, choose-folder action, detail names the CLI remedy", () => {
    clearConfiguredRoot();
    const r = repoRootRow(fakeProbes({ home: HOME }), team({ mode: "join" }), snapshot())!;
    expect(r.status).toBe("needs-you");
    expect(r.required).toBe(true);
    expect(r.action?.type).toBe("choose-folder");
    expect(r.detail).toContain("rt setup repo-root set");
  });

  // The store cannot hold the answer before Install (its file lives inside
  // the home repo), so a pre-Install answer lives only in staging.
  test("nothing set but a valid path STAGED -> ready", () => {
    clearConfiguredRoot();
    const p = fakeProbes({ home: HOME, statPaths: { [join(HOME, "dev")]: DIR } });
    stageRepoRoot(p, join(HOME, "dev"));
    const r = repoRootRow(p, team({ mode: "join" }), snapshot())!;
    expect(r.status).toBe("ready");
    expect(r.detail).toBe(join(HOME, "dev"));
  });

  // The predicate case: unwritten() reports false for a key explicitly
  // written as [], while every consumer of rt.repoRoots reads that as no
  // root. A row built on unwritten() would fall through to the stored
  // nothing instead of the staged answer and report needs-you here.
  test("rt.repoRoots explicitly written as [] at machine scope, with a valid path staged -> ready", () => {
    setSetting("rt.repoRoots", [], "machine");
    const p = fakeProbes({ home: HOME, statPaths: { [join(HOME, "dev")]: DIR } });
    stageRepoRoot(p, join(HOME, "dev"));
    const r = repoRootRow(p, team({ mode: "join" }), snapshot())!;
    expect(r.status).toBe("ready");
  });

  test("a staged path that no longer validates -> needs-you, same as a bad stored one", () => {
    clearConfiguredRoot();
    const p = fakeProbes({ home: HOME }); // no statPaths entry -> statPath returns null -> "does not exist"
    stageRepoRoot(p, join(HOME, "gone"));
    const r = repoRootRow(p, team({ mode: "join" }), snapshot())!;
    expect(r.status).toBe("needs-you");
    expect(r.detail).toContain("does not exist");
  });

  // Cannot happen by construction (the verb writes one or the other, never
  // both) -- assert the row still resolves deterministically to the stored
  // one so a future change to the verb fails here rather than silently.
  test("store and staging both hold values -> resolves to the stored one", () => {
    const p = fakeProbes({ home: HOME, statPaths: { [join(HOME, "stored")]: DIR, [join(HOME, "staged")]: DIR } });
    setSetting("rt.repoRoots", [join(HOME, "stored")], "machine");
    stageRepoRoot(p, join(HOME, "staged"));
    const r = repoRootRow(p, team({ mode: "join" }), snapshot())!;
    expect(r.status).toBe("ready");
    expect(r.detail).toBe(join(HOME, "stored"));
  });

  test("unset with a detected candidate -> startAt carries it, status still needs-you", () => {
    clearConfiguredRoot();
    const candidate = join(HOME, "Documents", "GitHub");
    const p = fakeProbes({ home: HOME, dirs: { [candidate]: [] } });
    const r = repoRootRow(p, team({ mode: "join" }), snapshot())!;
    expect(r.status).toBe("needs-you");
    expect((r.action as { startAt: string | null }).startAt).toBe(candidate);
  });

  test("set and usable -> ready, detail names the path", () => {
    const path = join(HOME, "dev");
    setSetting("rt.repoRoots", [path], "machine");
    const p = fakeProbes({ home: HOME, statPaths: { [path]: DIR } });
    const r = repoRootRow(p, team({ mode: "join" }), snapshot())!;
    expect(r.status).toBe("ready");
    expect(r.detail).toBe(path);
  });

  test("set under ~/Documents -> ready, detail also carries the TCC warning", () => {
    const path = join(HOME, "Documents", "GitHub");
    setSetting("rt.repoRoots", [path], "machine");
    const p = fakeProbes({ home: HOME, statPaths: { [path]: DIR } });
    const r = repoRootRow(p, team({ mode: "join" }), snapshot())!;
    expect(r.status).toBe("ready");
    expect(r.detail).toContain(path);
    expect(r.detail).toContain("Documents");
  });

  test("set but missing -> needs-you, detail names the path", () => {
    const path = join(HOME, "gone");
    setSetting("rt.repoRoots", [path], "machine");
    const p = fakeProbes({ home: HOME });
    const r = repoRootRow(p, team({ mode: "join" }), snapshot())!;
    expect(r.status).toBe("needs-you");
    expect(r.detail).toContain(path);
  });

  test("set but a file -> needs-you, not ready", () => {
    const path = join(HOME, "notes.txt");
    setSetting("rt.repoRoots", [path], "machine");
    const p = fakeProbes({ home: HOME, statPaths: { [path]: { isDirectory: false, writable: true } } });
    const r = repoRootRow(p, team({ mode: "join" }), snapshot())!;
    expect(r.status).toBe("needs-you");
  });

  test("set but unwritable -> needs-you, not ready", () => {
    const path = join(HOME, "locked");
    setSetting("rt.repoRoots", [path], "machine");
    const p = fakeProbes({ home: HOME, statPaths: { [path]: { isDirectory: true, writable: false } } });
    const r = repoRootRow(p, team({ mode: "join" }), snapshot())!;
    expect(r.status).toBe("needs-you");
  });

  test("stored as ~/dev with the directory present -> ready (expansion, via checkRepoRoot)", () => {
    setSetting("rt.repoRoots", ["~/dev"], "machine");
    const p = fakeProbes({ home: HOME, statPaths: { [join(HOME, "dev")]: DIR } });
    const r = repoRootRow(p, team({ mode: "join" }), snapshot())!;
    expect(r.status).toBe("ready");
    expect(r.detail).toBe(join(HOME, "dev"));
  });

  // Author the value that really throws: expandString hits
  // required(ctx.repoRoot, "repoRoot", "a repo path") in the resolver, the
  // same failure lib/repo-index.ts guards against. This must read as
  // needs-you with the picker, never as an exception that would take the
  // whole tools group down through buildGroup's catch.
  test("getSetting throws -> needs-you with the picker, never an exception", () => {
    setSetting("rt.repoRoots", ["${repoRoot}"], "machine");
    expect(() => getSetting<string[]>("rt.repoRoots").value).toThrow();

    const p = fakeProbes({ home: HOME });
    const r = repoRootRow(p, team({ mode: "join" }), snapshot())!;
    expect(r).not.toBeNull();
    expect(r.status).toBe("needs-you");
    expect(r.action?.type).toBe("choose-folder");
  });
});
