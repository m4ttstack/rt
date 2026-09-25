/**
 * The pure renderers of `rt settings list` (commands/settings-keys.ts).
 *
 * Rendering is where the two "loud degrade" labels live, and they are easy to
 * get wrong in exactly one direction: an UNREGISTERED key has no registry
 * entry, so `migrated` comes back false for it by default — the naive
 * `if (!s.migrated)` branch then tells the user the key "reads legacy",
 * naming a migration window that does not exist for a key rt has never heard
 * of. These tests pin both labels apart.
 */

import { describe, expect, test } from "bun:test";
import { renderExplainRow, renderListRow } from "../settings-keys.ts";
import type { ListedSetting } from "../../lib/settings/resolve.ts";

/** Strips ANSI so assertions read as plain text. */
// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\[[0-9;]*m/g, "");

const row = (over: Partial<ListedSetting>): ListedSetting =>
  ({ key: "rt.roles", value: 1, provenance: [], migrated: true, ...over }) as ListedSetting;

describe("renderListRow", () => {
  test("an unregistered key is labelled ONLY unregistered — never 'reads legacy'", () => {
    const out = plain(renderListRow(row({ key: "rt.fromTheFuture", migrated: false, unregistered: true })));

    expect(out).toContain("(unregistered)");
    expect(out).not.toContain("legacy");
  });

  test("a registered migrated:false key still carries its legacy note", () => {
    const out = plain(renderListRow(row({ key: "rt.someLegacyKey", migrated: false })));

    expect(out).toMatch(/legacy|not writable/);
    expect(out).not.toContain("unregistered");
  });

  test("a plain migrated key renders with no label at all", () => {
    expect(plain(renderListRow(row({ value: { a: 1 } })))).toBe("  rt.roles = {\"a\":1}");
  });

  test("list labels nonconforming layers and merged issues", () => {
    const out = plain(renderListRow(row({
      key: "rt.homeSnapshot", value: { enabled: "yes" }, provenance: [{ scope: "machine", file: "/tmp/x" }], migrated: true,
      nonconforming: [{ scope: "machine", file: "/tmp/x", issues: [{ path: ["enabled"], message: "expected boolean, got string" }] }],
      mergedIssues: [{ path: ["enabled"], message: "expected boolean, got string" }],
    })));

    expect(out).toContain("nonconforming[machine]: enabled: expected boolean, got string");
    expect(out).toContain("merged: enabled: expected boolean, got string");
  });
});

describe("renderExplainRow", () => {
  test("explain shows a nonconforming layer with its first issue", () => {
    const line = plain(renderExplainRow({
      scope: "machine", file: "/tmp/settings.local.jsonc", present: true, value: { enabled: "yes" },
      nonconforming: [{ path: ["enabled"], message: "expected boolean, got string" }],
    }));

    expect(line).toContain("[nonconforming: enabled: expected boolean, got string]");
  });
});
