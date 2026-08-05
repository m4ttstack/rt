#!/usr/bin/env bun
/**
 * GitLab branch protection used to report `allowDeletion: false`,
 * `requiredApprovals: 0`, and `requireStatusChecks: false` as unconditional
 * constants for every rule. `allowDeletion: false` happens to be correct
 * (a protected branch cannot be deleted while protected, and GitLab has no
 * per-branch toggle to read otherwise), but the other two were fabrications:
 * anyone reading `requiredApprovals` was reading the number zero, never a
 * measurement. This is the same hardcoded-constant shape as MAT-14, MAT-27,
 * and the GitLab discussion rollup fixed earlier in this plan.
 *
 * GitLab models both fields at project scope, not per branch:
 * `requireStatusChecks` from the project's `only_allow_merge_if_pipeline_succeeds`,
 * `requiredApprovals` from the project's approval configuration
 * (`approvals_before_merge`, via `MergeRequestApprovals.showConfiguration`).
 * Every rule returned for a project therefore carries the same project-level
 * value; these tests pin that alongside the per-branch fields that still vary.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

function branch(
  name: string,
  opts: { allowForcePush?: boolean } = {}
): Record<string, unknown> {
  return {
    name,
    allow_force_push: opts.allowForcePush ?? false,
    push_access_levels: [{ access_level: 40 }],
    merge_access_levels: [{ access_level: 40 }],
  };
}

function providerWith(opts: {
  branches?: Array<Record<string, unknown>>;
  pipelineMustSucceed?: boolean;
  approvalsBeforeMerge?: number;
  onBranchesFail?: Error;
  onProjectFail?: Error;
  onApprovalsFail?: Error;
}): GitLabProvider {
  const provider = new GitLabProvider('https://gitlab.example.com', 'x');
  (provider as any).gb.ProtectedBranches.all = async () => {
    if (opts.onBranchesFail) throw opts.onBranchesFail;
    return opts.branches ?? [branch('main')];
  };
  (provider as any).gb.Projects.show = async () => {
    if (opts.onProjectFail) throw opts.onProjectFail;
    return { only_allow_merge_if_pipeline_succeeds: opts.pipelineMustSucceed ?? false };
  };
  (provider as any).gb.MergeRequestApprovals.showConfiguration = async () => {
    if (opts.onApprovalsFail) throw opts.onApprovalsFail;
    return { approvals_before_merge: opts.approvalsBeforeMerge ?? 0 };
  };
  return provider;
}

describe('GitLabProvider.fetchBranchProtectionRules', () => {
  test('a project requiring pipeline success reports requireStatusChecks: true', async () => {
    const provider = providerWith({ pipelineMustSucceed: true });

    const rules = await provider.fetchBranchProtectionRules('g/p');

    expect(rules[0]?.requireStatusChecks).toBe(true);
  });

  test('a project not requiring pipeline success reports requireStatusChecks: false', async () => {
    const provider = providerWith({ pipelineMustSucceed: false });

    const rules = await provider.fetchBranchProtectionRules('g/p');

    expect(rules[0]?.requireStatusChecks).toBe(false);
  });

  test('a project with an approval rule requiring two approvals reports requiredApprovals: 2', async () => {
    const provider = providerWith({ approvalsBeforeMerge: 2 });

    const rules = await provider.fetchBranchProtectionRules('g/p');

    expect(rules[0]?.requiredApprovals).toBe(2);
  });

  test('requiredApprovals tracks the stubbed approvals_before_merge, zero included', async () => {
    // Pairing a zero-approvals provider with a nonzero one and checking both
    // in the same test is what makes this genuinely discriminating: a
    // hardcoded `requiredApprovals: 0` would still pass a lone "reports 0"
    // assertion, since 0 is indistinguishable from the old constant on its
    // own. It cannot also produce 5 from a different stub.
    const zero = providerWith({ approvalsBeforeMerge: 0 });
    const five = providerWith({ approvalsBeforeMerge: 5 });

    const zeroRules = await zero.fetchBranchProtectionRules('g/p');
    const fiveRules = await five.fetchBranchProtectionRules('g/p');

    expect(zeroRules[0]?.requiredApprovals).toBe(0);
    expect(fiveRules[0]?.requiredApprovals).toBe(5);
  });

  test('allowDeletion stays false and allowForcePush still comes from the branch', async () => {
    const provider = providerWith({
      branches: [branch('main', { allowForcePush: true })],
    });

    const rules = await provider.fetchBranchProtectionRules('g/p');

    expect(rules[0]?.allowDeletion).toBe(false);
    expect(rules[0]?.allowForcePush).toBe(true);
  });

  test('every rule for a project carries the same project-scoped values', async () => {
    const provider = providerWith({
      branches: [branch('main'), branch('release/*')],
      pipelineMustSucceed: true,
      approvalsBeforeMerge: 3,
    });

    const rules = await provider.fetchBranchProtectionRules('g/p');

    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.requiredApprovals).toBe(3);
      expect(rule.requireStatusChecks).toBe(true);
    }
  });

  test('a failure reading the project settings throws rather than fabricating a value', async () => {
    const provider = providerWith({ onProjectFail: new Error('project read boom') });

    await expect(provider.fetchBranchProtectionRules('g/p')).rejects.toThrow(/project read boom/);
  });

  test('a failure reading the approval configuration throws rather than fabricating a value', async () => {
    const provider = providerWith({ onApprovalsFail: new Error('approvals read boom') });

    await expect(provider.fetchBranchProtectionRules('g/p')).rejects.toThrow(/approvals read boom/);
  });

  test('a failure reading protected branches still throws (pre-existing behavior)', async () => {
    const provider = providerWith({ onBranchesFail: new Error('branches read boom') });

    await expect(provider.fetchBranchProtectionRules('g/p')).rejects.toThrow(/branches read boom/);
  });

  test('project settings and approval configuration are each fetched once per call, not once per branch', async () => {
    let projectCalls = 0;
    let approvalCalls = 0;
    const provider = providerWith({
      branches: [branch('main'), branch('develop'), branch('release/*')],
    });
    const originalProjectShow = (provider as any).gb.Projects.show;
    (provider as any).gb.Projects.show = async (...args: unknown[]) => {
      projectCalls++;
      return originalProjectShow(...args);
    };
    const originalShowConfig = (provider as any).gb.MergeRequestApprovals.showConfiguration;
    (provider as any).gb.MergeRequestApprovals.showConfiguration = async (...args: unknown[]) => {
      approvalCalls++;
      return originalShowConfig(...args);
    };

    await provider.fetchBranchProtectionRules('g/p');

    expect(projectCalls).toBe(1);
    expect(approvalCalls).toBe(1);
  });
});
