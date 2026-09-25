/**
 * mr:comment: posts one top-level note, as a resolvable discussion by
 * default or a plain note, and never reports a landed note as failed.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CreatedDiscussion, CreatedNote } from "@mattstack/glance";
import { closeStateDb } from "../../state/index.ts";
import { createDiscussionHandlers, type CommentMutator, type DiscussionHandlerSeams } from "../handlers/discussions.ts";
import { fakeStore } from "./fake-cache-store.ts";

const fakeCtx = { repoIndex: () => ({}), cache: fakeStore({}) };
const IDENTITY = "remote:gitlab.com%2Fg%2Fsub%2Frepo-tools";
const MR_URL = "https://gitlab.example.com/g/sub/repo-tools/-/merge_requests/7";

function note(id: number, resolvable: boolean | null): CreatedNote {
  return { id, resolvable, type: null } as unknown as CreatedNote;
}

function makeSeams(mutator: Partial<CommentMutator>, refresh?: DiscussionHandlerSeams["refresh"]): DiscussionHandlerSeams {
  const unexpected = async (): Promise<never> => { throw new Error("unexpected mutator call"); };
  return {
    repoContext: async () => ({ provider: { baseURL: "https://gitlab.example.com" }, projectPath: "g/sub/repo-tools", projectId: 99 }),
    gitlabToken: async () => "tok",
    commentMutator: () => ({ createDiscussion: unexpected, createNote: unexpected, ...mutator }) as CommentMutator,
    refresh: refresh ?? (async () => undefined),
  };
}

describe("mr:comment", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rt-comment-"));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("default posts a resolvable discussion and returns the note and MR urls", async () => {
    let args: unknown[] = [];
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({
      createDiscussion: async (...a) => { args = a; return { id: "d1", notes: [note(101, true)] } as CreatedDiscussion; },
    }));
    const res = await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "summary" });
    expect(args).toEqual([99, 7, "summary"]);
    expect(res).toEqual({
      ok: true,
      data: { noteId: 101, discussionId: "d1", resolvable: true, url: `${MR_URL}#note_101`, mrUrl: MR_URL },
    });
  });

  test("resolvable:false posts a plain note with a null discussionId", async () => {
    let args: unknown[] = [];
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({
      createNote: async (...a) => { args = a; return note(202, false); },
    }));
    const res = await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "summary", resolvable: false });
    expect(args).toEqual([99, 7, "summary"]);
    expect(res).toEqual({
      ok: true,
      data: { noteId: 202, discussionId: null, resolvable: false, url: `${MR_URL}#note_202`, mrUrl: MR_URL },
    });
  });

  test("resolvable reports what GitLab returned, not what was asked", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({
      createDiscussion: async () => ({ id: "d1", notes: [note(101, false)] }) as CreatedDiscussion,
    }));
    const res = await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "x" });
    expect(res.ok && res.data.resolvable).toBe(false);
  });

  test("a whitespace-only body is refused before any network call", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({}));
    const res = await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "  \n " });
    expect(res).toEqual({ ok: false, error: "missing repoName/iid/body" });
  });

  test("a fractional or non-positive iid is refused before any network call", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({}));
    expect(await h["mr:comment"]({ repoName: IDENTITY, iid: 1.5, body: "x" })).toEqual({ ok: false, error: "missing repoName/iid/body" });
    expect(await h["mr:comment"]({ repoName: IDENTITY, iid: 0, body: "x" })).toEqual({ ok: false, error: "missing repoName/iid/body" });
  });

  test("a non-boolean resolvable is refused before any network call", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({}));
    const res = await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "x", resolvable: "false" });
    expect(res).toEqual({ ok: false, error: "invalid resolvable" });
  });

  test("a non-identity repoName is refused the way discussions:reply refuses it", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({}));
    const res = await h["mr:comment"]({ repoName: "not-an-identity", iid: 7, body: "x" });
    expect(res).toEqual({ ok: false, error: "repo must be a serialized identity" });
  });

  test("a discussion created with no notes names the discussion it created", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({
      createDiscussion: async () => ({ id: "d9", notes: [] }) as unknown as CreatedDiscussion,
    }));
    const res = await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("d9");
  });

  test("a refresh throw after the post still returns ok", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(
      { createDiscussion: async () => ({ id: "d1", notes: [note(101, true)] }) as CreatedDiscussion },
      async () => { throw new Error("refresh boom"); },
    ));
    const res = await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "x" });
    expect(res.ok).toBe(true);
  });

  test("the refresh completes before the handler resolves", async () => {
    let refreshFinished = false;
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(
      { createDiscussion: async () => ({ id: "d1", notes: [note(101, true)] }) as CreatedDiscussion },
      async () => { await new Promise((r) => setTimeout(r, 10)); refreshFinished = true; },
    ));
    await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "x" });
    expect(refreshFinished).toBe(true);
  });
});
