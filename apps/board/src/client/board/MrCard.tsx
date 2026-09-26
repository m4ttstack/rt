import type { BoardMRWithReview } from '../types.ts';
import { ago, cleanTitle } from './format.ts';
import { MrLinks } from './MrLinks.tsx';
import { PersonLead } from './PersonLead.tsx';

/** A review gate's identity card: the invader, the author and where the MR
    merges, and its links share the top line; the title, the age and diff
    size, and the branch each take the card's full width below it. */
export function MrCard({ mr }: { mr: BoardMRWithReview }) {
  return (
    <div className="tui-id-card tui-mr-card">
      <PersonLead
        id={mr.author.username}
        name={mr.author.name || mr.author.username}
        trailing={<MrLinks mr={mr} />}
      >
        opened <span className="tui-id-card-ref">!{mr.iid}</span> into{' '}
        {mr.targetBranch}
      </PersonLead>
      <p className="tui-id-card-title">{cleanTitle(mr.title)}</p>
      <p className="tui-id-card-meta">
        <span>{ago(mr.createdAt, Date.now())}</span>
        {mr.diff && (
          <span className="tui-mr-card-diff">
            · <span className="tui-mr-card-diff-add">+{mr.diff.additions}</span>
            <span className="tui-mr-card-diff-del">-{mr.diff.deletions}</span>
          </span>
        )}
      </p>
      {mr.sourceBranch && (
        <p className="tui-id-card-branch" title={mr.sourceBranch}>
          {mr.sourceBranch}
        </p>
      )}
    </div>
  );
}
