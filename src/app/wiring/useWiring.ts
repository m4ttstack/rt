import { useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';

import { client } from '../api';
import {
  buildSpine,
  type SkillsCheck,
  type SkillsComposition,
} from './outline';

type SkillsPacks = InferResponseType<typeof client.api.skills.packs.$get, 200>;
export type SkillsSurface = InferResponseType<
  typeof client.api.skills.surface.$get,
  200
>;
export type SkillsSurfaceRow = SkillsSurface['rows'][number];
export type SkillsCompilePreview = InferResponseType<
  typeof client.api.skills.compile.$get,
  200
>;
export type SkillsHistory = InferResponseType<
  typeof client.api.skills.history.$get,
  200
>;
export type SkillsDiff = InferResponseType<
  typeof client.api.skills.diff.$get,
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
  enabled?: boolean;
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

/** `pack` may be null while the caller has not resolved one yet (the same
    shape `useSkillsCheck`/`useCompositionSnapshot` take) -- `enabled`
    defaults to that, but a caller that only wants this to fetch once its own
    drawer is open (the roster) overrides it via `options`. */
export function useSurface(pack: string | null, options?: SharedQueryOptions) {
  return useQuery({
    queryKey: ['skills', 'surface', pack],
    queryFn: async () => {
      const res = await client.api.skills.surface.$get({
        query: { pack: pack ?? '' },
      });
      return readOrThrow<SkillsSurface>(res, 'skills surface');
    },
    enabled: pack !== null,
    ...options,
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

/**
 * One verb's pack history, plus the runtime facts the same request measured.
 * Conditional on the drawer being open: this spawns git three times
 * (`rev-parse`, `log`, `status`) and rt once, and reads the pack manifest --
 * which no page load should pay for a drawer nobody opened.
 *
 * `staleTime: 0` on purpose -- half this payload is momentary (a dirty
 * working tree, a version on disk), so reopening the drawer must re-measure
 * rather than redraw what was true when it was last closed.
 */
export function useSkillsHistory(
  pack: string | undefined,
  verb: string | null
) {
  return useQuery({
    queryKey: ['skills', 'history', pack ?? null, verb],
    queryFn: async () => {
      const res = await client.api.skills.history.$get({
        query: { pack: pack ?? '', verb: verb ?? undefined },
      });
      return readOrThrow<SkillsHistory>(res, 'skills history');
    },
    enabled: Boolean(pack && verb),
    staleTime: 0,
  });
}

/** The diff between two commits, over the WHOLE pack -- a verb's slot fills
    live outside its own `skills/<verb>/`, so a verb-scoped diff would drop
    exactly the hunks a seam can attribute. */
export function useSkillsDiff(
  pack: string | undefined,
  from: string | null,
  to: string | null
) {
  return useQuery({
    queryKey: ['skills', 'diff', pack ?? null, from, to],
    queryFn: async () => {
      const res = await client.api.skills.diff.$get({
        query: { pack: pack ?? '', from: from ?? '', to: to ?? '' },
      });
      return readOrThrow<SkillsDiff>(res, 'skills diff');
    },
    enabled: Boolean(pack && from && to),
  });
}

export interface SkillsSurfaceApplyStep {
  direction: 'public' | 'internal';
  names: string[];
  ok: boolean;
  error?: string;
}

export interface SkillsSurfaceApplyResponse {
  pack: string;
  steps: SkillsSurfaceApplyStep[];
  rows: SkillsSurfaceRow[] | null;
  reReadError?: string;
}

export interface SkillsBindResponse {
  pack: string;
  verb: string;
  slot: string;
  fill: string;
  ok: boolean;
  error?: string;
}

type SkillsPostFn = (args: {
  json: Record<string, unknown>;
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Both write routes answer a genuine service failure (400 usage error, 503
 * rt missing -- neither ever wrote anything) with an error body this throws
 * on, and a write ATTEMPT (200, or 502 for an apply/bind rt refused or only
 * partly landed) by resolving with the body -- callers read `ok`/`steps` off
 * the data the same way the surface roster already reads a partial failure,
 * rather than off the HTTP status alone.
 */
async function postSkillsWrite<TResponse>(
  post: SkillsPostFn,
  body: Record<string, unknown>
): Promise<TResponse> {
  const res = await post({ json: body });
  const payload = await res.json();
  if (!res.ok && res.status !== 502) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `request failed: ${res.status}`;
    throw new Error(message);
  }
  return payload as TResponse;
}

/** Every cached read a write to this pack can go stale -- the client mirror
    of the server's own per-pack cache sweep (`e8f4163`, mirrored again for
    `/api/skills/bind`): composition, surface, check, compile, and history all
    read the pack, and a surface-apply or a bind recompiles it. */
function invalidateSkillsQueries(queryClient: QueryClient, pack: string) {
  for (const scope of [
    'composition',
    'surface',
    'check',
    'compile',
    'history',
  ]) {
    void queryClient.invalidateQueries({ queryKey: ['skills', scope, pack] });
  }
}

/** The one client mutation surface for both skills writes -- the surface
    roster's Apply and Rebind's Apply both go through this, so there is one
    place that invalidates the pack's cache on success rather than two that
    could drift apart. */
export function useSkillsApply(pack: string) {
  const queryClient = useQueryClient();
  const onSuccess = () => invalidateSkillsQueries(queryClient, pack);

  const surfaceApply = useMutation({
    mutationFn: (delta: { toPublic: string[]; toInternal: string[] }) =>
      postSkillsWrite<SkillsSurfaceApplyResponse>(
        client.api.skills.surface.apply.$post,
        { pack, ...delta }
      ),
    onSuccess,
  });

  const bind = useMutation({
    mutationFn: (write: { verb: string; slot: string; fill: string }) =>
      postSkillsWrite<SkillsBindResponse>(client.api.skills.bind.$post, {
        pack,
        ...write,
      }),
    onSuccess,
  });

  return { surfaceApply, bind };
}

/** Fetches one verb's compiled preview on demand, sharing the exact cache
    entry `useCompilePreview` fills (same query key) so a verb whose drawer
    is already open is not fetched twice. Used by the copy-agent-context
    action, which needs a verb's seams whether or not anyone has opened its
    compile preview. */
export async function fetchCompilePreview(
  queryClient: QueryClient,
  pack: string,
  verb: string
): Promise<SkillsCompilePreview> {
  return queryClient.fetchQuery({
    queryKey: ['skills', 'compile', pack, verb],
    queryFn: async () => {
      const res = await client.api.skills.compile.$get({
        query: { pack, verb },
      });
      return readOrThrow<SkillsCompilePreview>(res, 'skills compile preview');
    },
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
