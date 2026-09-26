/**
 * DiffStats — reusable diff statistics display with spark dot grid.
 *
 * Shows +additions / -deletions counts with a proportional dot grid
 * where each dot is colored green (additions-heavy) or red (deletions-heavy).
 * The dot count is capped to avoid overwhelming the UI with large MRs.
 */

import { cn } from '@/utils';

import { Row } from '../ui/flex';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DiffStatsProps {
  diff: {
    additions: number;
    deletions: number;
    filesChanged: number;
  } | null;
  /** Maximum number of dots to render. Each dot proportionally represents files. @default 20 */
  maxDots?: number;
  /** Hide the dot grid — only show the +/- numbers. */
  hideDots?: boolean;
  className?: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function DiffStats({ diff, maxDots = 20, hideDots, className }: DiffStatsProps) {
  if (!diff) return null;

  const total = diff.additions + diff.deletions;
  const files = diff.filesChanged;
  const dotCount = Math.min(files, maxDots);
  const greenDots =
    total > 0 ? Math.round((diff.additions / total) * dotCount) : dotCount;

  return (
    <div className={cn('space-y-2', className)}>
      <Row gap={3} className="text-sm font-semibold">
        <span className="text-positive">+{diff.additions}</span>
        <span className="text-negative">-{diff.deletions}</span>
        <span className="text-muted-foreground text-xs font-normal">
          {files} files
        </span>
      </Row>
      {!hideDots && (
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: dotCount }, (_, i) => (
            <div
              key={i}
              className={cn(
                'size-2 rounded-full',
                i < greenDots ? 'bg-positive' : 'bg-negative'
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
