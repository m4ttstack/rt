import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useSettingsScope,
  type EffectiveWire,
  type ExplainRowWire,
  type SettingDefWire,
} from '@mattstack/settings-kit/react';

const BASE = '/api/settings';
// Matches no registered key: that scope instance exists only to lend
// settings-kit's move, which is not exported on its own.
const MOVE_ONLY_PREFIX = 'console.move-only.';

export interface Unregistered {
  key: string;
  scope: string;
  file: string;
}

export interface RepoOption {
  identity: string;
  label: string;
}

type Write = Promise<string | null>;

export interface ConsoleStore {
  defs: SettingDefWire[];
  unregistered: Unregistered[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  set: (key: string, scope: string, value: unknown, repo?: string) => Write;
  unset: (key: string, scope: string, repo?: string) => Write;
  move: (key: string, from: string, to: string) => Write;
  prune: (
    key: string,
    scope: string,
    storeName: string,
    repo?: string
  ) => Write;
}

export interface KeyExplain {
  def: SettingDefWire | null;
  rows: ExplainRowWire[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** The repo picked on /settings, or null for all repos. */
export const SettingsRepoContext = createContext<string | null>(null);

export function useSettingsRepo(): string | null {
  return useContext(SettingsRepoContext);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = (await res.json().catch(() => null)) as
    (T & { error?: string }) | null;
  if (!res.ok)
    throw new Error(body?.error ?? `settings request failed: ${res.status}`);
  if (body === null) throw new Error('settings response was not JSON');
  return body;
}

function query(params: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** `repo` as a write body's optional field: an object with `repo` when
    given, else no key at all, so an omitted repo never reaches the wire. */
function withRepo(repo?: string): { repo: string } | Record<string, never> {
  return repo ? { repo } : {};
}

/** Every registered def under `prefix`, resolved for `repo` when one is
    picked. A write patches its def at once and then re-reads the list
    without raising `loading`, since it can change the def's issues and the
    repos that set it. */
export function useConsoleSettings(
  repo: string | null,
  prefix = ''
): ConsoleStore {
  const [defs, setDefs] = useState<SettingDefWire[]>([]);
  const [unregistered, setUnregistered] = useState<Unregistered[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const quiet = useRef(false);
  const kit = useSettingsScope(MOVE_ONLY_PREFIX);

  useEffect(() => {
    let alive = true;
    if (!quiet.current) setLoading(true);
    quiet.current = false;
    getJson<{ defs: SettingDefWire[]; unregistered?: Unregistered[] }>(
      `${BASE}/defs${query({ prefix, repo })}`
    )
      .then(body => {
        if (!alive) return;
        setDefs(body.defs);
        setUnregistered(body.unregistered ?? []);
        setError(null);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [prefix, repo, generation]);

  const refresh = useCallback(() => setGeneration(g => g + 1), []);
  const reread = useCallback(() => {
    quiet.current = true;
    setGeneration(g => g + 1);
  }, []);

  const post = useCallback(
    async (
      path: 'set' | 'unset' | 'prune',
      key: string,
      body: Record<string, unknown>
    ): Write => {
      try {
        const res = await fetch(`${BASE}/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, ...body }),
        });
        const out = (await res.json().catch(() => null)) as {
          effective?: EffectiveWire;
          error?: string;
        } | null;
        if (!res.ok || !out?.effective)
          return out?.error ?? `${path} failed: ${res.status}`;
        const effective = out.effective;
        const bodyRepo = typeof body.repo === 'string' ? body.repo : null;
        setDefs(prev =>
          prev.map(d => {
            if (d.key !== key) return d;
            // A repo-scoped def's `effective` is resolved for the repo the
            // write body carried; patching it here when that repo differs
            // from this hook's own picked repo would show a repo-specific
            // value where the hook reads another repo (or all of them).
            // The reread that follows re-resolves it for the right repo.
            if (d.repoScoped && bodyRepo !== repo) return d;
            return { ...d, effective };
          })
        );
        reread();
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },
    [reread, repo]
  );

  const set = useCallback(
    (key: string, scope: string, value: unknown, r?: string) =>
      post('set', key, { scope, value, ...withRepo(r) }),
    [post]
  );
  const unset = useCallback(
    (key: string, scope: string, r?: string) =>
      post('unset', key, { scope, ...withRepo(r) }),
    [post]
  );
  const prune = useCallback(
    (key: string, scope: string, storeName: string, r?: string) =>
      post('prune', key, { scope, storeName, force: true, ...withRepo(r) }),
    [post]
  );
  const { move: kitMove } = kit;
  const move = useCallback(
    async (key: string, from: string, to: string) => {
      const err = await kitMove(key, from, to);
      reread();
      return err;
    },
    [kitMove, reread]
  );

  return useMemo(
    () => ({
      defs,
      unregistered,
      loading,
      error,
      refresh,
      set,
      unset,
      move,
      prune,
    }),
    [defs, unregistered, loading, error, refresh, set, unset, move, prune]
  );
}

/** One key's layer stack, with the picked repo's rungs when one is given. */
export function useKeyExplain(key: string, repo: string | null): KeyExplain {
  const [def, setDef] = useState<SettingDefWire | null>(null);
  const [rows, setRows] = useState<ExplainRowWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getJson<{ def: SettingDefWire; rows: ExplainRowWire[] }>(
      `${BASE}/explain/${encodeURIComponent(key)}${query({ repo })}`
    )
      .then(body => {
        if (!alive) return;
        setDef(body.def);
        setRows(body.rows);
        setError(null);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [key, repo, generation]);

  const refresh = useCallback(() => setGeneration(g => g + 1), []);
  return useMemo(
    () => ({ def, rows, loading, error, refresh }),
    [def, rows, loading, error, refresh]
  );
}

export function useRepos(): { repos: RepoOption[]; error: string | null } {
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getJson<{ repos?: RepoOption[] }>(`${BASE}/repos`)
      .then(body => alive && setRepos(body.repos ?? []))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);
  return { repos, error };
}
