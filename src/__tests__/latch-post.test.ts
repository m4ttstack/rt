import { describe, expect, test } from "bun:test";
import { mkdirSync, cpSync } from "fs";
import { join } from "path";
import { latchKindOf } from "../latch/markers.ts";
import { postLatch, spendLatch, type LatchGateway } from "../latch/post.ts";
import type { LatchRef } from "../latch/discussions.ts";
import { APP_ROOT } from "../app-root.ts";

// test-setup.ts points BOARD_APP_ROOT at a throwaway temp dir per test file,
// so postLatch's default banner path (derived from APP_ROOT) misses the real
// committed band unless this file seeds it too, same as latch-banner.test.ts.
mkdirSync(join(APP_ROOT, "assets"), { recursive: true });
cpSync(join(import.meta.dir, "..", "..", "assets", "latch-band.png"), join(APP_ROOT, "assets", "latch-band.png"));

const MR = "https://gitlab.com/acme/web/-/merge_requests/2317";
const IMG = "![re-review latch](/uploads/ab12/latch-2317.png)";

function gateway() {
  const calls: string[] = [];
  const bodies: string[] = [];
  const gw: LatchGateway = {
    async uploadFile(_p, filename) {
      calls.push(`upload:${filename}`);
      return { alt: "latch", url: "/uploads/ab12/latch-2317.png", full_path: "x", markdown: IMG };
    },
    async createDiscussion(_p, _iid, body) {
      calls.push("createDiscussion");
      bodies.push(body);
      return { id: "d1", notes: [{ id: 1 } as never] };
    },
    async updateNote(_p, _iid, noteId, body) {
      calls.push(`updateNote:${noteId}`);
      bodies.push(body);
    },
    async resolveDiscussion(_path, _iid, id) {
      calls.push(`resolve:${id}`);
    },
    async unresolveDiscussion(_path, _iid, id) {
      calls.push(`unresolve:${id}`);
    },
    async createNote(_p, _iid, body) {
      calls.push("createNote");
      bodies.push(body);
      return { id: 9 } as never;
    },
  };
  return { gw, calls, bodies };
}

describe("postLatch", () => {
  test("uploads the banner then creates a resolvable discussion", async () => {
    const { gw, calls, bodies } = gateway();
    await postLatch(gw, 42, "acme/web", MR, 2317);
    expect(calls).toEqual(["upload:latch-2317.png", "createDiscussion"]);
    expect(latchKindOf(bodies[0]!)).toBe("armed");
    expect(bodies[0]).toContain(IMG);
  });
});

describe("spendLatch", () => {
  const armed: LatchRef = {
    discussionId: "d1",
    rootNoteId: 1,
    kind: "armed",
    resolved: true,
    createdAt: "2026-09-01T10:00:00Z",
    body: `<!-- mattstack:board re-review-latch v1 -->\n\n${IMG}\n\nbody`,
  };

  // Rewrite BEFORE resolve. A crash between them leaves a spent-but-unresolved
  // latch, which the pass repairs. The reverse leaves a resolved-but-unspent
  // latch, which is indistinguishable from a human request.
  test("rewrites the body before resolving", async () => {
    const { gw, calls, bodies } = gateway();
    await spendLatch(gw, 42, "acme/web", 2317, armed);
    expect(calls).toEqual(["updateNote:1", "resolve:d1"]);
    expect(latchKindOf(bodies[0]!)).toBe("spent");
  });

  // The banner is already uploaded; spending must not upload it again.
  test("reuses the uploaded banner instead of re-uploading", async () => {
    const { gw, calls, bodies } = gateway();
    await spendLatch(gw, 42, "acme/web", 2317, armed);
    expect(calls.some((c) => c.startsWith("upload:"))).toBe(false);
    expect(bodies[0]).toContain(IMG);
  });

  test("an already-spent latch that is resolved draws no writes", async () => {
    const { gw, calls } = gateway();
    await spendLatch(gw, 42, "acme/web", 2317, { ...armed, kind: "spent", resolved: true });
    expect(calls).toEqual([]);
  });

  // The crash-repair path: body already spent, thread still open.
  test("an already-spent latch that is unresolved is only re-resolved", async () => {
    const { gw, calls } = gateway();
    await spendLatch(gw, 42, "acme/web", 2317, { ...armed, kind: "spent", resolved: false });
    expect(calls).toEqual(["resolve:d1"]);
  });
});
