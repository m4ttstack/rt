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

const TRANSITIONAL = 'GitLab is still checking, try again';

const MERGE_REFUSALS: Record<string, string> = {
  conflict: 'merge conflicts',
  not_approved: 'not approved yet',
  need_rebase: 'needs a rebase',
  ci_must_pass: 'pipeline must pass',
  ci_still_running: 'pipeline still running',
  discussions_not_resolved: 'threads to resolve',
  draft_status: 'still a draft',
  requested_changes: 'changes requested',
  not_open: 'not open',
  merge_request_blocked: 'blocked by another MR',
  preparing: TRANSITIONAL,
  unchecked: TRANSITIONAL,
  checking: TRANSITIONAL,
  approvals_syncing: TRANSITIONAL,
};

/** GitLab's refusal in words, read from the detailedMergeStatus glance
    appends to a 405 after reading the MR back; null when there is none. */
export function mergeRefusalReason(message: string): string | null {
  const status = /detailedMergeStatus="([a-z_]+)"/.exec(message)?.[1];
  if (!status || status === 'mergeable') return null;
  return MERGE_REFUSALS[status] ?? status.replaceAll('_', ' ');
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
