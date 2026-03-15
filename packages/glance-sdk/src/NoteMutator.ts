/**
 * REST API helpers for GitLab note mutations.
 *
 * Uses numeric projectId + mrIid so callers don't need the project full path.
 * Mirrors the GitLab REST API:
 *   POST   /api/v4/projects/:id/merge_requests/:mrIid/notes
 *   POST   /api/v4/projects/:id/merge_requests/:mrIid/discussions/:discussionId/notes
 *   PUT    /api/v4/projects/:id/merge_requests/:mrIid/notes/:noteId
 *   DELETE /api/v4/projects/:id/merge_requests/:mrIid/notes/:noteId
 */

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
}

export class NoteMutator {
  private readonly baseURL: string;
  private readonly token: string;

  constructor(baseURL: string, token: string) {
    this.baseURL = baseURL.replace(/\/$/, "");
    this.token = token;
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
    const url = discussionId
      ? `${this.baseURL}/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions/${discussionId}/notes`
      : `${this.baseURL}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PRIVATE-TOKEN": this.token,
      },
      body: JSON.stringify({ body }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `createNote failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
      );
    }

    return (await res.json()) as CreatedNote;
  }

  /** Edit the body of an existing note. */
  async updateNote(
    projectId: number,
    mrIid: number,
    noteId: number,
    body: string,
  ): Promise<void> {
    const url = `${this.baseURL}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes/${noteId}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "PRIVATE-TOKEN": this.token,
      },
      body: JSON.stringify({ body }),
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
    const url = `${this.baseURL}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes/${noteId}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { "PRIVATE-TOKEN": this.token },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `deleteNote failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
      );
    }
  }
}
