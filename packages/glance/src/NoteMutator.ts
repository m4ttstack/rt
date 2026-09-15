/**
 * REST API helpers for GitLab note mutations.
 *
 * Uses numeric projectId + mrIid so callers don't need the project full path.
 * Mirrors the GitLab REST API:
 *   POST   /api/v4/projects/:id/merge_requests/:mrIid/notes
 *   POST   /api/v4/projects/:id/merge_requests/:mrIid/discussions/:discussionId/notes
 *   PUT    /api/v4/projects/:id/merge_requests/:mrIid/notes/:noteId
 *   DELETE /api/v4/projects/:id/merge_requests/:mrIid/notes/:noteId
 *   POST   /api/v4/projects/:id/merge_requests/:mrIid/discussions
 *   POST   /api/v4/projects/:id/uploads
 *   GET    /api/v4/projects/:id/merge_requests/:mrIid
 */

import { type OnRequestHook, safeEmit } from './instrumentation.ts';

/** GitLab omits `type` on a general note; every CreatedNote producer must still return `null`, not `undefined`. */
function normalizeNoteType(note: CreatedNote): CreatedNote {
  return { ...note, type: note.type ?? null };
}

export interface CreatedNote {
  id: number;
  body: string;
  author: {
    id: number;
    username: string;
    name: string;
    avatar_url: string | null;
  };
  created_at: string;
  resolvable: boolean | null;
  resolved: boolean | null;
  /** "DiffNote" for a positioned note; null for a general note (or absent from the response). */
  type: string | null;
}

export interface CreatedDiscussion {
  id: string;
  notes: CreatedNote[];
}

export interface DiffRefs {
  base_sha: string;
  start_sha: string;
  head_sha: string;
}

export type TextPosition = DiffRefs & {
  position_type: "text";
  new_path: string;
  old_path: string;
} & (
    | { new_line: number; old_line?: never }
    | { old_line: number; new_line?: never }
    | { old_line: number; new_line: number }
  );

export interface UploadedFile {
  alt: string;
  url: string;
  full_path: string;
  /** Ready-to-paste markdown, e.g. `![latch](/uploads/<hash>/latch.png)`. */
  markdown: string;
}

export class NoteMutator {
  private readonly baseURL: string;
  private readonly token: string;
  private readonly onRequest?: OnRequestHook;

  constructor(baseURL: string, token: string, options: { onRequest?: OnRequestHook } = {}) {
    this.baseURL = baseURL.replace(/\/$/, "");
    this.token = token;
    this.onRequest = options.onRequest;
  }

  /**
   * Create a note on an MR, optionally within an existing discussion thread.
   * If `discussionId` is provided the note is posted as a reply to that thread.
   */
  async createNote(
    projectId: number,
    mrIid: number,
    body: string,
    discussionId?: string,
  ): Promise<CreatedNote> {
    const path = discussionId
      ? `/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions/${discussionId}/notes`
      : `/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PRIVATE-TOKEN": this.token,
      },
      body: JSON.stringify({ body }),
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.createNote',
      transport: 'rest',
      method: 'POST',
      path,
      durationMs: performance.now() - started,
      status: res.status,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `createNote failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
      );
    }

    return normalizeNoteType((await res.json()) as CreatedNote);
  }

  /**
   * Create a NEW discussion thread on an MR. Unlike createNote's /notes
   * endpoint, a discussion created this way is resolvable, which is the whole
   * reason to prefer it: callers that need a thread a human can resolve cannot
   * get one from /notes.
   */
  async createDiscussion(
    projectId: number,
    mrIid: number,
    body: string,
  ): Promise<CreatedDiscussion> {
    const path = `/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PRIVATE-TOKEN": this.token,
      },
      body: JSON.stringify({ body }),
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.createDiscussion',
      transport: 'rest',
      method: 'POST',
      path,
      durationMs: performance.now() - started,
      status: res.status,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `createDiscussion failed: ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`,
      );
    }
    const discussion = (await res.json()) as CreatedDiscussion;
    return { ...discussion, notes: discussion.notes.map(normalizeNoteType) };
  }

  /**
   * Create a positioned (inline) discussion anchored to a line in the diff.
   * `position` must be sent as a nested JSON object, not bracketed form
   * fields: GitLab silently drops the position (and degrades to a general
   * note) when the nesting isn't JSON.
   */
  async createPositionedDiscussion(
    projectId: number,
    mrIid: number,
    body: string,
    position: TextPosition,
  ): Promise<CreatedDiscussion> {
    const path = `/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PRIVATE-TOKEN": this.token,
      },
      body: JSON.stringify({ body, position }),
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.createPositionedDiscussion',
      transport: 'rest',
      method: 'POST',
      path,
      durationMs: performance.now() - started,
      status: res.status,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `createPositionedDiscussion failed: ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`,
      );
    }
    const discussion = (await res.json()) as CreatedDiscussion;
    return { ...discussion, notes: discussion.notes.map(normalizeNoteType) };
  }

  /**
   * Fetch the MR's current `diff_refs`, needed to anchor a positioned
   * discussion (see `createPositionedDiscussion`). GitLab omits `diff_refs`
   * until the MR has a diff to anchor against.
   */
  async fetchDiffRefs(projectId: number, mrIid: number): Promise<DiffRefs> {
    const path = `/api/v4/projects/${projectId}/merge_requests/${mrIid}`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();

    const res = await fetch(url, {
      method: "GET",
      headers: { "PRIVATE-TOKEN": this.token },
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.fetchDiffRefs',
      transport: 'rest',
      method: 'GET',
      path,
      durationMs: performance.now() - started,
      status: res.status,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `fetchDiffRefs failed: ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`,
      );
    }

    const data = (await res.json()) as { diff_refs: DiffRefs | null };
    if (!data.diff_refs) {
      throw new Error(
        `fetchDiffRefs: merge request !${mrIid} in project ${projectId} has no diff_refs yet`,
      );
    }
    return data.diff_refs;
  }

  /** Edit the body of an existing note. */
  async updateNote(
    projectId: number,
    mrIid: number,
    noteId: number,
    body: string,
  ): Promise<void> {
    const path = `/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes/${noteId}`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "PRIVATE-TOKEN": this.token,
      },
      body: JSON.stringify({ body }),
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.updateNote',
      transport: 'rest',
      method: 'PUT',
      path,
      durationMs: performance.now() - started,
      status: res.status,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `updateNote failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
      );
    }
  }

  /** Permanently delete a note. */
  async deleteNote(projectId: number, mrIid: number, noteId: number): Promise<void> {
    const path = `/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes/${noteId}`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();
    const res = await fetch(url, {
      method: "DELETE",
      headers: { "PRIVATE-TOKEN": this.token },
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.deleteNote',
      transport: 'rest',
      method: 'DELETE',
      path,
      durationMs: performance.now() - started,
      status: res.status,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `deleteNote failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
      );
    }
  }

  /**
   * Upload a file to a project's markdown uploads store. The returned `url` is
   * project-relative and only renders inside that project's markdown, so an
   * upload cannot be shared across projects.
   *
   * Content-Type is deliberately unset: fetch derives the multipart boundary
   * from the FormData body, and setting the header by hand strips it.
   */
  async uploadFile(
    projectId: number,
    filename: string,
    bytes: Uint8Array,
    contentType = "application/octet-stream",
  ): Promise<UploadedFile> {
    const path = `/api/v4/projects/${projectId}/uploads`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);

    const res = await fetch(url, {
      method: "POST",
      headers: { "PRIVATE-TOKEN": this.token },
      body: form,
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.uploadFile',
      transport: 'rest',
      method: 'POST',
      path,
      durationMs: performance.now() - started,
      status: res.status,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `uploadFile failed: ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`,
      );
    }
    return (await res.json()) as UploadedFile;
  }
}
