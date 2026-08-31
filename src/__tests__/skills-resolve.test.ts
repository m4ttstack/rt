import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { existsSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The three wrapper skills and the slot contracts they must declare. The
// contract names are cluster D's provides table (acme-pack): the pack and
// the board have to agree on these strings exactly.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const wrappers = [
  { dir: "review", name: "board:review", slots: { review: "mr-review@1" } },
  { dir: "respond", name: "board:respond", slots: { respond: "mr-respond@1" } },
  {
    dir: "doctor",
    name: "board:doctor",
    slots: { doctor: "mr-doctor@1", "doctor-api": "mr-doctor-api@1" },
  },
] as const;

const resolverPath = (dir: string) => join(repoRoot, "skills", dir, "scripts", "resolve-args.sh");

// Inert fixture skills: frontmatter only, never invoked. One per contract,
// plus one whose provides is deliberately wrong.
const fix = mkdtempSync(join(tmpdir(), "mr-board-skills-resolve-"));
const skillsDir = join(fix, "skills-dir");
const fixtureSkill = (name: string, provides: string) => {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: "test fixture, never invoked"\nmetadata:\n  provides: "${provides}"\n---\n`,
  );
  return name;
};
fixtureSkill("fake:review", "mr-review@1");
fixtureSkill("fake:respond", "mr-respond@1");
fixtureSkill("fake:doctor", "mr-doctor@1");
fixtureSkill("fake:doctor-api", "mr-doctor-api@1");
fixtureSkill("fake:wrong-contract", "review-domain@1");

const boundManifest = join(fix, "bound.jsonc");
writeFileSync(
  boundManifest,
  `// fixture bindings for the wrapper resolution tests
{
  "version": 1,
  "bindings": {
    "board:review":  { "review": "fake:review" },
    "board:respond": { "respond": "fake:respond" },
    "board:doctor":  { "doctor": "fake:doctor", "doctor-api": "fake:doctor-api" }
  }
}
`,
);
const mismatchManifest = join(fix, "mismatch.jsonc");
writeFileSync(
  mismatchManifest,
  `{ "version": 1, "bindings": { "board:review": { "review": "fake:wrong-contract" } } }\n`,
);
const missingManifest = join(fix, "does-not-exist.jsonc");

const resolve = (dir: string, manifest: string) => {
  const proc = Bun.spawnSync(
    [resolverPath(dir), "--manifest", manifest, "--skills-dir", skillsDir, "--plugin-list-cmd", "echo []"],
    { stdout: "pipe", stderr: "pipe" },
  );
  return { exitCode: proc.exitCode, out: JSON.parse(proc.stdout.toString()) };
};

describe("wrapper skill slot resolution", () => {
  const canonicalRepo = [process.env.MATTSTACK_SKILLS_REPO, join(homedir(), "Documents/GitHub/mattstack-skills")]
    .filter((p): p is string => !!p)
    .find((p) => existsSync(join(p, "plugin/skills/parameterized-skills/scripts/resolve-args.sh")));

  test("vendored resolve-args.sh is byte-identical across the three wrappers", () => {
    const copies = wrappers.map((w) => readFileSync(resolverPath(w.dir)));
    expect(copies[1]!.equals(copies[0]!)).toBe(true);
    expect(copies[2]!.equals(copies[0]!)).toBe(true);
  });

  test.skipIf(!canonicalRepo)("vendored resolve-args.sh is byte-identical to the canonical resolver", () => {
    const canonical = readFileSync(
      join(canonicalRepo!, "plugin/skills/parameterized-skills/scripts/resolve-args.sh"),
    );
    for (const w of wrappers) {
      expect(readFileSync(resolverPath(w.dir)).equals(canonical)).toBe(true);
    }
  });

  for (const w of wrappers) {
    describe(w.name, () => {
      const skillMd = readFileSync(join(repoRoot, "skills", w.dir, "SKILL.md"), "utf8");

      test("declares its slots with the pack's contract names", () => {
        expect(skillMd).toContain(`slots: "${Object.keys(w.slots).join(",")}"`);
        for (const [slot, contract] of Object.entries(w.slots)) {
          expect(skillMd).toContain(`slot-${slot}: "required ${contract} -- `);
        }
      });

      test("documents the resolution order: explicit --skill wins before the resolver runs", () => {
        const argWins = skillMd.indexOf("**Explicit `--skill <name>` wins.**");
        const resolver = skillMd.indexOf('"${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"');
        expect(argWins).toBeGreaterThan(-1);
        expect(resolver).toBeGreaterThan(argWins);
        expect(skillMd).toContain("Never guess or substitute a binding");
      });

      test("resolves its slots from a manifest binding", () => {
        const { exitCode, out } = resolve(w.dir, boundManifest);
        expect(exitCode).toBe(0);
        expect(out.ok).toBe(true);
        expect(out.skill).toBe(w.name);
        for (const [slot, contract] of Object.entries(w.slots)) {
          expect(out.resolved[slot].binding).toBe(`fake:${slot}`);
          expect(out.resolved[slot].contract).toBe(contract);
          expect(out.resolved[slot].path).toBe(join(skillsDir, `fake:${slot}`));
        }
      });

      test("unbound slots fail loud with machine-readable errors", () => {
        const { exitCode, out } = resolve(w.dir, missingManifest);
        expect(exitCode).toBe(1);
        expect(out.ok).toBe(false);
        const bySlot = new Map(out.errors.map((e: { slot: string; code: string }) => [e.slot, e.code]));
        for (const slot of Object.keys(w.slots)) {
          expect(bySlot.get(slot)).toBe("unbound");
        }
      });
    });
  }

  test("a binding whose provides does not match the contract fails loud", () => {
    const { exitCode, out } = resolve("review", mismatchManifest);
    expect(exitCode).toBe(1);
    expect(out.errors[0].code).toBe("provides-mismatch");
    expect(out.errors[0].message).toContain("mr-review@1");
  });
});
