/** Not a resume command -- a real resume needs the snapshot, `RT_RUN_DB`,
    and stage re-entry, none of which this builds. This is the one handoff
    action that's actually true today: checking out the run's branch. */
export const BRANCH_CHECKOUT_LABEL = 'Copy branch checkout';

export function branchCheckoutCommand(branch: string): string {
  return `git checkout ${branch}`;
}
