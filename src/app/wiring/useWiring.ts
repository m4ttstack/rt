import { useMemo } from 'react';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';

import { client } from '../api';
import {
  buildSpine,
  type SkillsCheck,
  type SkillsComposition,
} from './outline';

type SkillsPacks = InferResponseType<typeof client.api.skills.packs.$get, 200>;
type SkillsSurface = InferResponseType<
  typeof client.api.skills.surface.$get,
  200
>;
type SkillsCompilePreview = InferResponseType<
  typeof client.api.skills.compile.$get,
  200
>;

/** Every skills route answers a usage error and the surface's own "nothing
    to show" case with the same JSON shape -- pull the real message out of
    it instead of surfacing a bare status code. */
async function readOrThrow<T>(
  res: { ok: boolean; status: number; json(): Promise<unknown> },
  label: string
): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    const message =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `${label} failed: ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

/** The subset of react-query options these hooks let a caller override.
    Narrow on purpose: the rail needs a longer stale time than the page, and
    nothing else about these queries is the caller's business. */
interface SharedQueryOptions {
  staleTime?: number;
  refetchOnWindowFocus?: boolean;
}

export function usePacks(options?: SharedQueryOptions) {
  return useQuery({
    queryKey: ['skills', 'packs'],
    queryFn: async () => {
      const res = await client.api.skills.packs.$get();
      return readOrThrow<SkillsPacks>(res, 'skills packs');
    },
    ...options,
  });
}

// The outline cannot render without its roster, so this is the one suspense
// query on the surface -- check/surface/compile-preview all layer on top of
// what this call returns.
export function useComposition(pack: string) {
  return useSuspenseQuery({
    queryKey: ['skills', 'composition', pack],
    queryFn: async () => {
      const res = await client.api.skills.composition.$get({ query: { pack } });
      return readOrThrow<SkillsComposition>(res, 'skills composition');
    },
  });
}

/** The same cache entry `useComposition` fills, read WITHOUT suspending.
    The page header needs the work types and the fetch time while staying
    outside the outline's suspense boundary -- the pack picker has to survive
    a composition failure, which is the whole reason that boundary is scoped
    to the outline. Same query key, so this shares the fetch rather than
    issuing a second one. */
export function useCompositionSnapshot(
  pack: string | null,
  options?: SharedQueryOptions
) {
  return useQuery({
    queryKey: ['skills', 'composition', pack],
    queryFn: async () => {
      const res = await client.api.skills.composition.$get({
        query: { pack: pack ?? '' },
      });
      return readOrThrow<SkillsComposition>(res, 'skills composition');
    },
    enabled: pack !== null,
    ...options,
  });
}

export function useSkillsCheck(
  pack: string | null,
  options?: SharedQueryOptions
) {
  return useQuery({
    queryKey: ['skills', 'check', pack],
    queryFn: async () => {
      const res = await client.api.skills.check.$get({
        query: { pack: pack ?? '' },
      });
      return readOrThrow<SkillsCheck>(res, 'skills check');
    },
    enabled: pack !== null,
    ...options,
  });
}

export function useSurface(pack: string) {
  return useQuery({
    queryKey: ['skills', 'surface', pack],
    queryFn: async () => {
      const res = await client.api.skills.surface.$get({ query: { pack } });
      return readOrThrow<SkillsSurface>(res, 'skills surface');
    },
  });
}

/** Conditional on a verb actually being open for preview -- most nodes in
    the outline never trigger this, so it stays a plain query rather than
    riding along with the route-level suspense. */
export function useCompilePreview(
  pack: string | undefined,
  verb: string | undefined
) {
  return useQuery({
    queryKey: ['skills', 'compile', pack ?? null, verb ?? null],
    queryFn: async () => {
      const res = await client.api.skills.compile.$get({
        query: { pack: pack ?? '', verb: verb ?? '' },
      });
      return readOrThrow<SkillsCompilePreview>(res, 'skills compile preview');
    },
    enabled: Boolean(pack && verb),
  });
}

/** `rt skills check` costs four subprocesses per pack, and the rail is
    mounted on every route -- a refetch on every window focus would pay that
    to redraw a badge that changes when a compile does. */
const RAIL_QUERY_OPTIONS: SharedQueryOptions = {
  staleTime: 60_000,
  refetchOnWindowFocus: false,
};

/**
 * How many rows on the Wiring spine need attention, for readers mounted
 * outside the Wiring route. Runs `buildSpine` rather than counting anything
 * itself: the rail badge and the spine's own header must be the same number,
 * and two derivations of it would eventually disagree.
 *
 * Shares its query keys with the page, so opening /wiring reuses these
 * fetches instead of issuing its own. Answers 0 while the queries are in
 * flight and when they fail -- an absent badge, never a wrong one.
 */
export function useAttentionCount(): number {
  const packsQuery = usePacks(RAIL_QUERY_OPTIONS);
  const pack = packsQuery.data?.packs[0]?.name ?? null;
  const compositionQuery = useCompositionSnapshot(pack, RAIL_QUERY_OPTIONS);
  const checkQuery = useSkillsCheck(pack, RAIL_QUERY_OPTIONS);

  const composition = compositionQuery.data;
  const check = checkQuery.data;

  return useMemo(
    () =>
      composition
        ? buildSpine(composition, check ?? { verbs: [] }, null).attentionCount
        : 0,
    [composition, check]
  );
}
