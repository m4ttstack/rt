import { GitLabProvider, NoteMutator } from '@mattstack/glance';
import type { LatchGateway } from './post.ts';

/** The latch's GitLab writes, bound to one board's host and token. */
export function latchGateway(host: string, token: string): LatchGateway {
  const mutator = new NoteMutator(host, token);
  const provider = new GitLabProvider(host, token);
  return {
    uploadFile: (p, f, b, ct) => mutator.uploadFile(p, f, b, ct),
    createDiscussion: (p, iid, body) => mutator.createDiscussion(p, iid, body),
    updateNote: (p, iid, noteId, body) =>
      mutator.updateNote(p, iid, noteId, body),
    resolveDiscussion: (path, iid, id) =>
      provider.resolveDiscussion(path, iid, id),
    unresolveDiscussion: (path, iid, id) =>
      provider.unresolveDiscussion(path, iid, id),
    createNote: (p, iid, body, discussionId) =>
      mutator.createNote(p, iid, body, discussionId),
  };
}
