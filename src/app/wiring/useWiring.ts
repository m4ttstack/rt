import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';

import { client } from '../api';
import type { SkillsCheck, SkillsComposition } from './outline';

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

export function usePacks() {
  return useQuery({
    queryKey: ['skills', 'packs'],
    queryFn: async () => {
      const res = await client.api.skills.packs.$get();
      return readOrThrow<SkillsPacks>(res, 'skills packs');
    },
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

export function useSkillsCheck(pack: string) {
  return useQuery({
    queryKey: ['skills', 'check', pack],
    queryFn: async () => {
      const res = await client.api.skills.check.$get({ query: { pack } });
      return readOrThrow<SkillsCheck>(res, 'skills check');
    },
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
