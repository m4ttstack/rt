import { DiffSelection } from './diff-selection'
import { DiffHunk } from './raw-diff'

/** The enum representation of a Git file change in GitHub Desktop. */
export enum AppFileStatusKind {
  New = 'New',
  Modified = 'Modified',
  Deleted = 'Deleted',
  Copied = 'Copied',
  Renamed = 'Renamed',
  Conflicted = 'Conflicted',
  Untracked = 'Untracked',
}

/** A file with a selection state, used by formatPatch */
export interface PatchTarget {
  readonly path: string
  readonly status: { readonly kind: AppFileStatusKind }
  readonly selection: DiffSelection
}

/** A diff-like object with hunks, used by formatPatch */
export interface TextDiffLike {
  readonly hunks: ReadonlyArray<DiffHunk>
}
