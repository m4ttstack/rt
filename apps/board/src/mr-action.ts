import type { PullRequest } from '@mattstack/glance';

/** The GitLab-side MR actions the board's context menu can fire. Merge sends
    no MergePullRequestInput so the project's own merge settings (squash,
    delete source branch) decide, the same as GitLab's button. */
export type MrAction = 'merge' | 'rebase' | 'setAutoMerge' | 'cancelAutoMerge';

const MR_ACTIONS: readonly MrAction[] = [
  'merge',
  'rebase',
  'setAutoMerge',
  'cancelAutoMerge',
];

/** The slice of GitLabProvider these actions need, structural so tests can
    hand in a fake without a network. */
export interface MrActionProvider {
  mergePullRequest(projectPath: string, mrIid: number): Promise<PullRequest>;
  rebasePullRequest(projectPath: string, mrIid: number): Promise<void>;
  setAutoMerge(projectPath: string, mrIid: number): Promise<void>;
  cancelAutoMerge(projectPath: string, mrIid: number): Promise<void>;
}

/** Exact json media-type check for the CSRF gate: isLocalRequest reads the
    Host header, which a cross-origin form can forge, so state-changing
    endpoints require a content type only a preflighted request can carry. An
    `includes('application/json')` check is NOT equivalent — a simple request
    may smuggle the string in a parameter (`text/plain;foo=application/json`)
    without ever tripping a preflight, so only the media type itself counts. */
export function isJsonMediaType(contentType: string | null): boolean {
  if (!contentType) return false;
  return (
    contentType.split(';', 1)[0]!.trim().toLowerCase() === 'application/json'
  );
}

export function parseMrActionBody(
  body: unknown
): { mrUrl: string; iid: number; action: MrAction } | null {
  if (!body || typeof body !== 'object') return null;
  const { mrUrl, iid, action } = body as {
    mrUrl?: unknown;
    iid?: unknown;
    action?: unknown;
  };
  if (typeof mrUrl !== 'string' || !mrUrl) return null;
  if (typeof iid !== 'number' || !Number.isFinite(iid)) return null;
  if (typeof action !== 'string' || !(MR_ACTIONS as string[]).includes(action))
    return null;
  return { mrUrl, iid, action: action as MrAction };
}

export async function runMrAction(
  provider: MrActionProvider,
  projectPath: string,
  iid: number,
  action: MrAction
): Promise<void> {
  switch (action) {
    case 'merge':
      await provider.mergePullRequest(projectPath, iid);
      return;
    case 'rebase':
      await provider.rebasePullRequest(projectPath, iid);
      return;
    case 'setAutoMerge':
      await provider.setAutoMerge(projectPath, iid);
      return;
    case 'cancelAutoMerge':
      await provider.cancelAutoMerge(projectPath, iid);
      return;
  }
}
