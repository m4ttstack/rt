import { extractTicketId, ticketUrl } from '../../ticket.ts';
import type { BoardMRWithReview } from '../types.ts';
import { GitHubLogo, GitLabLogo, LinearLogo } from './icons.tsx';

/** Whether an MR lives on GitHub: its provider when the row carries one,
    else its URL (or a gate's `mr:<url>` subject); GitLab otherwise. */
export function onGitHub(mr?: BoardMRWithReview, subject?: string): boolean {
  if (mr?.provider) return mr.provider === 'github';
  return (mr?.webUrl ?? subject ?? '').includes('github.com');
}

/** "pull request" on GitHub, "merge request" on GitLab. */
export function forgeNoun(mr?: BoardMRWithReview, subject?: string): string {
  return onGitHub(mr, subject) ? 'pull request' : 'merge request';
}

/** The MR's two external homes as logo links: its forge page, and the
    Linear ticket its branch or title names (absent when it names none). */
export function MrLinks({ mr }: { mr: BoardMRWithReview }) {
  const ticket = mr.sourceBranch
    ? extractTicketId(mr.sourceBranch, mr.title)
    : null;
  const github = onGitHub(mr);
  const forge = github ? 'GitHub' : 'GitLab';
  return (
    <span className="tui-mr-links">
      {mr.webUrl && (
        <a
          className="tui-mr-link"
          href={mr.webUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={`open !${mr.iid} in ${forge}`}
          aria-label={`open !${mr.iid} in ${forge}`}
        >
          {github ? <GitHubLogo /> : <GitLabLogo />}
        </a>
      )}
      {ticket && (
        <a
          className="tui-mr-link"
          href={ticketUrl(ticket)}
          target="_blank"
          rel="noopener noreferrer"
          title={`open ${ticket} in Linear`}
          aria-label={`open ${ticket} in Linear`}
        >
          <LinearLogo />
        </a>
      )}
    </span>
  );
}
