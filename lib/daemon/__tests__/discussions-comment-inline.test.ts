/**
 * mr:comment-inline: posts a positioned discussion, verifies the created
 * note's type from the creation response, and repairs a silent GitLab
 * general-note degrade with one delete-and-retry.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CreatedDiscussion, TextPosition } from "@mattstack/glance";
import { closeStateDb } from "../../state/index.ts";
import { createDiscussionHandlers, type DiscussionHandlerSeams } from "../handlers/discussions.ts";
import { fakeStore } from "./fake-cache-store.ts";

const fakeCtx = { repoIndex: () => ({}), cache: fakeStore({}) };

const IDENTITY = "remote:gitlab.com%2Fg%2Frepo-tools";
const REPO_PATH = "/tmp/does-not-matter";

const DIFF_REFS = { base_sha: "b", start_sha: "s", head_sha: "h" };

function fakeDiscussion(id: string, noteId: number, type: string | null): CreatedDiscussion {
  return { id, notes: [{ id: noteId, type }] } as unknown as CreatedDiscussion;
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    repoName: IDENTITY,
    iid: 7,
    body: "nice catch",
    path: "src/foo.ts",
    line: 42,
    ...overrides,
  };
}

/** Builds seams around a scripted mutator; repoContext/gitlabToken use fixed stubs. */
function makeSeams(mutator: DiscussionHandlerSeams["mutator"], refresh?: DiscussionHandlerSeams["refresh"]): DiscussionHandlerSeams {
  return {
    repoContext: async () => ({ provider: { baseURL: "https://gitlab.example.com" }, projectPath: "g/repo-tools", projectId: 99 }),
    gitlabToken: async () => "tok",
    mutator,
    refresh: refresh ?? (async () => undefined),
  };
}

describe("mr:comment-inline", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rt-comment-inline-"));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("a clean DiffNote on the first try returns ok:true verified:true", async () => {
    let fetchDiffRefsCalls = 0;
    let createCalls = 0;
    const seams = makeSeams(() => ({
      fetchDiffRefs: async () => { fetchDiffRefsCalls++; return DIFF_REFS; },
      createPositionedDiscussion: async () => {
        createCalls++;
        return fakeDiscussion("d1", 101, "DiffNote");
      },
      deleteNote: async () => { throw new Error("deleteNote should not be called on a clean first try"); },
    }));

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res).toEqual({ ok: true, data: { discussionId: "d1", noteId: 101, verified: true } });
    expect(fetchDiffRefsCalls).toBe(1);
    expect(createCalls).toBe(1);
  });

  test("degrade then clean on retry deletes the first note and succeeds on the second", async () => {
    const deletedIds: number[] = [];
    let createCalls = 0;
    let fetchDiffRefsCalls = 0;
    const seams = makeSeams(() => ({
      fetchDiffRefs: async () => { fetchDiffRefsCalls++; return DIFF_REFS; },
      createPositionedDiscussion: async () => {
        createCalls++;
        if (createCalls === 1) return fakeDiscussion("d1", 101, null);
        return fakeDiscussion("d2", 102, "DiffNote");
      },
      deleteNote: async (_projectId, _iid, noteId) => { deletedIds.push(noteId); },
    }));

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res).toEqual({ ok: true, data: { discussionId: "d2", noteId: 102, verified: true } });
    expect(deletedIds).toEqual([101]);
    expect(createCalls).toBe(2);
    expect(fetchDiffRefsCalls).toBe(2);
  });

  test("degrade twice returns ok:false naming both deleted note ids", async () => {
    const deletedIds: number[] = [];
    let createCalls = 0;
    const seams = makeSeams(() => ({
      fetchDiffRefs: async () => DIFF_REFS,
      createPositionedDiscussion: async () => {
        createCalls++;
        if (createCalls === 1) return fakeDiscussion("d1", 11, null);
        return fakeDiscussion("d2", 12, null);
      },
      deleteNote: async (_projectId, _iid, noteId) => { deletedIds.push(noteId); },
    }));

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res.ok).toBe(false);
    expect(deletedIds).toEqual([11, 12]);
    if (!res.ok) {
      expect(res.error).toContain("11");
      expect(res.error).toContain("12");
      expect(res.error).toContain("null");
      expect(res.error).not.toMatch(new RegExp("[\\u2013\\u2014]"));
    }
  });

  test("a non-identity repoName returns the same refusal discussions:reply produces", async () => {
    const seams = makeSeams(() => ({
      fetchDiffRefs: async () => { throw new Error("should not be called"); },
      createPositionedDiscussion: async () => { throw new Error("should not be called"); },
      deleteNote: async () => { throw new Error("should not be called"); },
    }));
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);

    const inline = await h["mr:comment-inline"]!(basePayload({ repoName: "not-an-identity" }));
    const reply = await h["discussions:reply"]!(
      { repoName: "not-an-identity", iid: 7, discussionId: "d", body: "x" } as unknown as never,
    );

    expect(inline).toEqual(reply as unknown as typeof inline);
    expect(inline).toEqual({ ok: false, error: "repo must be a serialized identity" });
  });

  test("a serialized identity not in the repo index returns the real getRepoContext refusal", async () => {
    // No repoContext seam: the real getRepoContext plumbing runs and must
    // refuse for an identity absent from the (empty) repo index, the same
    // way discussions:reply's real path does.
    const h = createDiscussionHandlers(fakeCtx, () => {});

    const inline = await h["mr:comment-inline"]!(basePayload());
    const reply = await h["discussions:reply"]!(
      { repoName: IDENTITY, iid: 7, discussionId: "d", body: "x" } as unknown as never,
    );

    expect(inline.ok).toBe(false);
    expect(reply.ok).toBe(false);
    expect(inline).toEqual(reply as unknown as typeof inline);
  });

  test("missing fields refuse before any network call", async () => {
    const seams = makeSeams(() => ({
      fetchDiffRefs: async () => { throw new Error("should not be called"); },
      createPositionedDiscussion: async () => { throw new Error("should not be called"); },
      deleteNote: async () => { throw new Error("should not be called"); },
    }));
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);

    const res = await h["mr:comment-inline"]!(basePayload({ line: 0 }));
    expect(res).toEqual({ ok: false, error: "missing repoName/iid/body/path/line" });
  });

  test("a non-positive-integer oldLine is refused before any network call", async () => {
    let called = false;
    const seams = makeSeams(() => ({
      fetchDiffRefs: async () => { called = true; return DIFF_REFS; },
      createPositionedDiscussion: async () => { called = true; return fakeDiscussion("d1", 1, "DiffNote"); },
      deleteNote: async () => { called = true; },
    }));
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);

    const res = await h["mr:comment-inline"]!(basePayload({ oldLine: 0 }));

    expect(res).toEqual({ ok: false, error: "invalid oldPath/oldLine" });
    expect(called).toBe(false);
  });

  test("an empty oldPath is refused before any network call", async () => {
    let called = false;
    const seams = makeSeams(() => ({
      fetchDiffRefs: async () => { called = true; return DIFF_REFS; },
      createPositionedDiscussion: async () => { called = true; return fakeDiscussion("d1", 1, "DiffNote"); },
      deleteNote: async () => { called = true; },
    }));
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);

    const res = await h["mr:comment-inline"]!(basePayload({ oldPath: "" }));

    expect(res).toEqual({ ok: false, error: "invalid oldPath/oldLine" });
    expect(called).toBe(false);
  });

  test("neither oldPath nor oldLine defaults old_path to the new path", async () => {
    let captured: TextPosition | undefined;
    const seams = makeSeams(() => ({
      fetchDiffRefs: async () => DIFF_REFS,
      createPositionedDiscussion: async (_pid, _mrIid, _body, position) => {
        captured = position;
        return fakeDiscussion("d1", 101, "DiffNote");
      },
      deleteNote: async () => { throw new Error("should not be called"); },
    }));
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);

    await h["mr:comment-inline"]!(basePayload());

    expect(captured).toEqual({
      ...DIFF_REFS,
      position_type: "text",
      new_path: "src/foo.ts",
      new_line: 42,
      old_path: "src/foo.ts",
    });
  });

  test("oldLine alone sets old_line and defaults old_path to the new path", async () => {
    let captured: TextPosition | undefined;
    const seams = makeSeams(() => ({
      fetchDiffRefs: async () => DIFF_REFS,
      createPositionedDiscussion: async (_pid, _mrIid, _body, position) => {
        captured = position;
        return fakeDiscussion("d1", 101, "DiffNote");
      },
      deleteNote: async () => { throw new Error("should not be called"); },
    }));
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);

    await h["mr:comment-inline"]!(basePayload({ oldLine: 10 }));

    expect(captured).toEqual({
      ...DIFF_REFS,
      position_type: "text",
      new_path: "src/foo.ts",
      new_line: 42,
      old_line: 10,
      old_path: "src/foo.ts",
    });
  });

  test("oldLine and oldPath together map straight through", async () => {
    let captured: TextPosition | undefined;
    const seams = makeSeams(() => ({
      fetchDiffRefs: async () => DIFF_REFS,
      createPositionedDiscussion: async (_pid, _mrIid, _body, position) => {
        captured = position;
        return fakeDiscussion("d1", 101, "DiffNote");
      },
      deleteNote: async () => { throw new Error("should not be called"); },
    }));
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);

    await h["mr:comment-inline"]!(basePayload({ oldLine: 10, oldPath: "src/old.ts" }));

    expect(captured).toEqual({
      ...DIFF_REFS,
      position_type: "text",
      new_path: "src/foo.ts",
      new_line: 42,
      old_line: 10,
      old_path: "src/old.ts",
    });
  });

  test("oldPath alone sets old_path with no old_line", async () => {
    let captured: TextPosition | undefined;
    const seams = makeSeams(() => ({
      fetchDiffRefs: async () => DIFF_REFS,
      createPositionedDiscussion: async (_pid, _mrIid, _body, position) => {
        captured = position;
        return fakeDiscussion("d1", 101, "DiffNote");
      },
      deleteNote: async () => { throw new Error("should not be called"); },
    }));
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);

    await h["mr:comment-inline"]!(basePayload({ oldPath: "src/old.ts" }));

    expect(captured).toEqual({
      ...DIFF_REFS,
      position_type: "text",
      new_path: "src/foo.ts",
      new_line: 42,
      old_path: "src/old.ts",
    });
  });

  test("a createPositionedDiscussion throw (400) returns ok:false with no delete and no retry", async () => {
    let deleteCalls = 0;
    let createCalls = 0;
    const seams = makeSeams(() => ({
      fetchDiffRefs: async () => DIFF_REFS,
      createPositionedDiscussion: async () => {
        createCalls++;
        throw new Error("createPositionedDiscussion failed: 400 Bad Request: line_code can't be blank");
      },
      deleteNote: async () => { deleteCalls++; },
    }));

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("line_code can't be blank");
    expect(deleteCalls).toBe(0);
    expect(createCalls).toBe(1);
  });

  test("a deleteNote failure during repair is not swallowed", async () => {
    const seams = makeSeams(() => ({
      fetchDiffRefs: async () => DIFF_REFS,
      createPositionedDiscussion: async () => fakeDiscussion("d1", 55, null),
      deleteNote: async () => { throw new Error("GitLab 500"); },
    }));

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("55");
      expect(res.error).toContain("GitLab 500");
    }
  });

  test("a retry throw after the first note degraded reports the degrade and the retry error together", async () => {
    const deletedIds: number[] = [];
    let createCalls = 0;
    const seams = makeSeams(() => ({
      fetchDiffRefs: async () => DIFF_REFS,
      createPositionedDiscussion: async () => {
        createCalls++;
        if (createCalls === 1) return fakeDiscussion("d1", 101, null);
        throw new Error("GitLab 503");
      },
      deleteNote: async (_projectId, _iid, noteId) => { deletedIds.push(noteId); },
    }));

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res.ok).toBe(false);
    expect(deletedIds).toEqual([101]);
    if (!res.ok) {
      expect(res.error).toContain("101");
      expect(res.error).toContain("null");
      expect(res.error).toContain("GitLab 503");
      expect(res.error).not.toMatch(new RegExp("[\\u2013\\u2014]"));
    }
  });

  test("a refresh throw after a verified post does not turn success into ok:false", async () => {
    const seams = makeSeams(
      () => ({
        fetchDiffRefs: async () => DIFF_REFS,
        createPositionedDiscussion: async () => fakeDiscussion("d1", 101, "DiffNote"),
        deleteNote: async () => { throw new Error("should not be called"); },
      }),
      async () => { throw new Error("refresh boom"); },
    );

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res).toEqual({ ok: true, data: { discussionId: "d1", noteId: 101, verified: true } });
  });

  test("the refresh call completes before the handler resolves", async () => {
    let refreshFinished = false;
    const seams = makeSeams(
      () => ({
        fetchDiffRefs: async () => DIFF_REFS,
        createPositionedDiscussion: async () => fakeDiscussion("d1", 101, "DiffNote"),
        deleteNote: async () => { throw new Error("should not be called"); },
      }),
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        refreshFinished = true;
      },
    );

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    await h["mr:comment-inline"]!(basePayload());

    expect(refreshFinished).toBe(true);
  });
});
