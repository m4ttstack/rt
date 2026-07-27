/**
 * Compile-time guard against parameter drift between `GitProvider` and its
 * implementations.
 *
 * TypeScript accepts a method that declares FEWER parameters than the
 * interface it satisfies, because a function ignoring trailing arguments is
 * substitutable for one that reads them. That rule is what let
 * `GitHubProvider.fetchPullRequests()` claim to implement
 * `fetchPullRequests(options?: FetchPullRequestsOptions)` while silently
 * discarding every option a caller passed (MAT-13).
 *
 * The assertions below fail `tsc` if an implementation is ever again not
 * callable with the full parameter list the interface promises. Extra optional
 * parameters on an implementation are fine — those still accept every
 * interface-shaped call.
 *
 * Nothing here emits runtime code; the file exists to be type-checked.
 */

import type { GitProvider } from './GitProvider.ts';
import type { GitHubProvider } from './GitHubProvider.ts';
import type { GitLabProvider } from './GitLabProvider.ts';

type AnyMethod = (...args: never[]) => unknown;

type MethodKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends AnyMethod ? K : never;
}[keyof T];

/** The set of argument counts a function type can be called with. */
type Arities<T> = NonNullable<T> extends AnyMethod
  ? Parameters<NonNullable<T>>['length']
  : never;

/**
 * Interface methods the implementation cannot be called with every declared
 * argument count for. Optional interface methods an implementation omits are
 * not drift, so they are excluded.
 */
export type DroppedParameters<I, C> = {
  [K in MethodKeys<I>]: K extends keyof C
    ? [Arities<I[K]>] extends [Arities<C[K]>]
      ? never
      : K
    : never;
}[MethodKeys<I>];

/**
 * Resolves only when `Drift` is empty. A failure reads as
 * "Type '<methodName>' does not satisfy the constraint 'never'", naming the
 * method whose parameter list narrowed.
 */
export type NoDroppedParameters<Drift extends never> = Drift;

type _GitHubImplementsGitProvider = NoDroppedParameters<
  DroppedParameters<GitProvider, GitHubProvider>
>;
type _GitLabImplementsGitProvider = NoDroppedParameters<
  DroppedParameters<GitProvider, GitLabProvider>
>;
