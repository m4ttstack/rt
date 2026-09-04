/** The auto-generated GitLab revert title, shared by the fetcher's cheap pre-test and the metric layer. */
export const REVERT_TITLE_RE = /^revert\s+"(.+)"\s*$/i;

/** Title-only test for raw list nodes, which carry no labels. */
export function isRevertTitle(title: string): boolean {
  return REVERT_TITLE_RE.test(title);
}
