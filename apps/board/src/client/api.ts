import type { BoardData, BoardMRWithReview, CommentThread, GeneralComment } from "./types.ts";

/** The shape every board action's server round-trip normalizes into. `body`
    stays a loose grab-bag of the fields any action might reply with, since
    different actions read different keys off it (focused/queued/linked/…). */
export interface ActionResult {
  ok: boolean;
  status: number;
  body: { focused?: boolean; queued?: boolean; linked?: boolean; status?: string; reactions?: string[] } | null;
  text: string;
}

/** POST one board action and normalize its response -- never throws: a
    network failure (fetch rejects) comes back as the same typed shape a
    non-ok HTTP response would, so every caller has one failure branch. */
export async function postAction(path: string, payload: unknown, fetcher: typeof fetch = fetch): Promise<ActionResult> {
  try {
    const r = await fetcher(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    let body: ActionResult["body"] = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { ok: r.ok, status: r.status, body, text };
  } catch {
    return { ok: false, status: 0, body: null, text: "" };
  }
}

/** The board's own snapshot. Deliberately doesn't gate on `r.ok` -- a non-ok
    response with a JSON body still resolves here, matching today's board
    (which never checked status before parsing /data.json). */
export function getData(fresh = false): Promise<BoardData> {
  return fetch(fresh ? "/data.json?fresh=1" : "/data.json").then((r) => r.json() as Promise<BoardData>);
}

/** A scoped, single-member refresh -- the 15s poll and the "refresh now"
    button use this instead of the whole-team snapshot. */
export function getMember(username: string): Promise<{ mrs: BoardMRWithReview[]; fetchedAt: number }> {
  return fetch(`/member?u=${encodeURIComponent(username)}`).then((r) =>
    r.ok ? (r.json() as Promise<{ mrs: BoardMRWithReview[]; fetchedAt: number }>) : Promise.reject(new Error("bad status")),
  );
}

/** An MR's review threads plus general (non-thread) comments, for the
    comments drawer. `comments` defaults to `[]` for older servers that don't
    send it. */
export function getDiscussions(
  repo: string,
  iid: number,
  author: string,
): Promise<{ threads: CommentThread[]; comments: GeneralComment[] }> {
  const params = new URLSearchParams({ repo, iid: String(iid), author });
  return fetch(`/discussions?${params}`)
    .then((r) =>
      r.ok
        ? (r.json() as Promise<{ threads: CommentThread[]; comments?: GeneralComment[] }>)
        : Promise.reject(new Error("bad status")),
    )
    .then((d) => ({
      threads: d.threads,
      comments: d.comments ?? [],
    }));
}
