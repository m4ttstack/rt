/**
 * Fetches MR detail (discussions) from GitLab via the REST API.
 *
 * Accepts numeric projectId for REST URL construction; returns DomainMRDetail
 * with a scoped repositoryId string (e.g. "gitlab:42").
 * Endpoint: GET /api/v4/projects/:id/merge_requests/:iid/discussions?per_page=100
 */

import type {
  Discussion,
  MRDetail,
  Note,
  NoteAuthor,
  NotePosition,
} from "./types.ts";
import { type ForgeLogger, noopLogger } from "./logger.ts";
import { type OnRequestHook, safeEmit } from "./instrumentation.ts";

// ---------------------------------------------------------------------------
// Raw REST response shapes
// ---------------------------------------------------------------------------

interface RESTNoteAuthor {
  id: number;
  username: string;
  name: string;
  avatar_url: string | null;
}

interface RESTNotePosition {
  old_path?: string | null;
  new_path?: string | null;
  old_line?: number | null;
  new_line?: number | null;
  position_type?: string | null;
}

interface RESTNote {
  id: number;
  type: string | null;
  body: string;
  author: RESTNoteAuthor;
  created_at: string;
  system: boolean;
  resolvable?: boolean | null;
  resolved?: boolean | null;
  position?: RESTNotePosition | null;
}

interface RESTDiscussion {
  id: string;
  notes: RESTNote[];
}

// ---------------------------------------------------------------------------
// MRDetailFetcher
// ---------------------------------------------------------------------------

export class MRDetailFetcher {
  private readonly baseURL: string;
  private readonly token: string;
  private readonly log: ForgeLogger;
  private readonly onRequest?: OnRequestHook;

  constructor(baseURL: string, token: string, options: { logger?: ForgeLogger; onRequest?: OnRequestHook } = {}) {
    this.baseURL = baseURL.replace(/\/$/, "");
    this.token = token;
    this.log = options.logger ?? noopLogger;
    this.onRequest = options.onRequest;
  }

  async fetchDetail(projectId: number, mrIid: number): Promise<MRDetail> {
    const path = `/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions`;
    const url = `${this.baseURL}${path}?per_page=100`;
    const started = performance.now();
    const res = await fetch(url, {
      headers: { "PRIVATE-TOKEN": this.token },
    });

    safeEmit(this.onRequest, {
      op: 'fetchMRDiscussions',
      transport: 'rest',
      method: 'GET',
      path,
      durationMs: performance.now() - started,
      status: res.status,
    });

    if (!res.ok) {
      throw new Error(`MR discussions fetch failed: ${res.status} ${res.statusText}`);
    }

    const raw = (await res.json()) as RESTDiscussion[];

    const discussions: Discussion[] = raw.map((d) => ({
      id: d.id,
      resolvable: null,
      resolved: null,
      notes: d.notes.map(toNote),
    }));

    this.log.debug("MRDetailFetcher.fetchDetail", {
      projectId,
      mrIid,
      discussionCount: discussions.length,
    });

    return { mrIid, repositoryId: `gitlab:${projectId}`, discussions };
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function toNote(n: RESTNote): Note {
  return {
    id: n.id,
    body: n.body,
    author: toAuthor(n.author),
    createdAt: n.created_at,
    system: n.system,
    type: n.type,
    resolvable: n.resolvable ?? null,
    resolved: n.resolved ?? null,
    position: n.position ? toPosition(n.position) : null,
  };
}

function toAuthor(a: RESTNoteAuthor): NoteAuthor {
  return {
    id: `gitlab:user:${a.id}`,
    username: a.username,
    name: a.name,
    avatarUrl: a.avatar_url,
  };
}

function toPosition(p: RESTNotePosition): NotePosition {
  return {
    newPath: p.new_path ?? null,
    oldPath: p.old_path ?? null,
    newLine: p.new_line ?? null,
    oldLine: p.old_line ?? null,
    positionType: p.position_type ?? null,
  };
}
