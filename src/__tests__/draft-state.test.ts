import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { attachDrafts, draftFilePath, heldDraftsByMr, pruneDrafts, readDrafts, writeDraft } from "../draft-state.ts";

const dir = () => mkdtempSync(join(tmpdir(), "drafts-"));

describe("draft state", () => {
  test("write, read, and group held drafts by MR", () => {
    const d = dir();
    writeDraft(draftFilePath("https://x/mr/1", "inherited-note", d), { mrUrl: "https://x/mr/1", iid: 1, kind: "inherited-note", body: "fails on master too", status: "held" });
    writeDraft(draftFilePath("https://x/mr/1", "rebase-note", d), { mrUrl: "https://x/mr/1", iid: 1, kind: "rebase-note", body: "needs rebase", status: "held" });
    writeDraft(draftFilePath("https://x/mr/2", "inherited-note", d), { mrUrl: "https://x/mr/2", iid: 2, kind: "inherited-note", body: "x", status: "dismissed" });
    const all = readDrafts(d);
    expect(all).toHaveLength(3);
    const held = heldDraftsByMr(all);
    expect(held.get("https://x/mr/1")).toHaveLength(2);
    expect(held.has("https://x/mr/2")).toBe(false); // dismissed is not held
  });

  test("status patch preserves body and stamps updatedAt", () => {
    const d = dir();
    const path = draftFilePath("https://x/mr/1", "inherited-note", d);
    writeDraft(path, { mrUrl: "https://x/mr/1", iid: 1, kind: "inherited-note", body: "b", status: "held" }, 100);
    const posted = writeDraft(path, { status: "posted", postedNoteId: 7 }, 200);
    expect(posted.body).toBe("b");
    expect(posted.createdAt).toBe(100);
    expect(posted.updatedAt).toBe(200);
    expect(posted.postedNoteId).toBe(7);
  });

  test("prune drops drafts whose MR left the board; attach decorates rows", () => {
    const d = dir();
    writeDraft(draftFilePath("https://x/mr/1", "k", d), { mrUrl: "https://x/mr/1", iid: 1, kind: "k", body: "b", status: "held" });
    writeDraft(draftFilePath("https://x/mr/9", "k", d), { mrUrl: "https://x/mr/9", iid: 9, kind: "k", body: "b", status: "held" });
    pruneDrafts(new Set(["https://x/mr/1"]), d);
    const held = heldDraftsByMr(readDrafts(d));
    expect(held.has("https://x/mr/9")).toBe(false);
    const rows = attachDrafts([{ webUrl: "https://x/mr/1" }, { webUrl: "https://x/mr/3" }], held);
    expect(rows[0]!.drafts).toHaveLength(1);
    expect(rows[1]!.drafts).toBeUndefined();
  });
});
