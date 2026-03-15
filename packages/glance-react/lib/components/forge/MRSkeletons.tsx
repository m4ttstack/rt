import { MRCard } from './MRCard';
import { MRRow, MRRowList } from './MRRow';
import { MRNode } from './MRNode';

// ── MRCardSkeleton ─────────────────────────────────────────────────────────────

export interface MRCardSkeletonProps {
  className?: string;
}

/**
 * Convenience wrapper — renders `MRCard` in its loading state.
 * Equivalent to `<MRCard loading />`.
 */
export function MRCardSkeleton({ className }: MRCardSkeletonProps) {
  return <MRCard loading className={className} />;
}

// ── MRRowSkeleton ──────────────────────────────────────────────────────────────

export interface MRRowSkeletonProps {
  className?: string;
}

/**
 * Convenience wrapper — renders `MRRow` in its loading state.
 * Equivalent to `<MRRow loading />`.
 */
export function MRRowSkeleton({ className }: MRRowSkeletonProps) {
  return <MRRow loading className={className} />;
}

// ── MRRowListSkeleton ──────────────────────────────────────────────────────────

export interface MRRowListSkeletonProps {
  /** Number of skeleton rows to render. Default: 3 */
  count?: number;
  className?: string;
}

/**
 * Convenience wrapper — renders `MRRowList` in its loading state.
 * Equivalent to `<MRRowList loading loadingCount={count} />`.
 */
export function MRRowListSkeleton({
  count = 3,
  className,
}: MRRowListSkeletonProps) {
  return <MRRowList loading loadingCount={count} className={className} />;
}

// ── MRNodeSkeleton ─────────────────────────────────────────────────────────────

export interface MRNodeSkeletonProps {
  className?: string;
}

/**
 * Convenience wrapper — renders `MRNode` in its loading state.
 * Equivalent to `<MRNode loading />`.
 */
export function MRNodeSkeleton({ className }: MRNodeSkeletonProps) {
  return <MRNode loading className={className} />;
}
