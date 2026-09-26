import { useSearchParams } from 'wouter';

const PARAM = 'explain';
const FIX = 'fix';

/** The key whose explain modal is open on /settings, kept in `?explain=` so
    a reload or a shared link reopens it; `?fix=` names the layer whose
    editor opens with it. */
export function useExplainParam() {
  const [params, setParams] = useSearchParams();
  const write = (
    key: string | null,
    push: boolean,
    opts: { fix?: string; repo?: string } = {}
  ) =>
    setParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (key) next.set(PARAM, key);
        else next.delete(PARAM);
        if (key && opts.fix) next.set(FIX, opts.fix);
        else next.delete(FIX);
        if (opts.repo) next.set('repo', opts.repo);
        return next;
      },
      push ? { state: { [PARAM]: true } } : { replace: true }
    );
  return {
    key: params.get(PARAM),
    fix: params.get(FIX),
    // Opening pushes so Back closes the modal before it leaves the page;
    // closing an entry we pushed pops it, so no duplicate is left behind.
    open: (key: string, opts?: { fix?: string; repo?: string }) =>
      write(key, true, opts),
    close: () => {
      const state = window.history.state as Record<string, unknown> | null;
      if (state?.[PARAM] === true) window.history.back();
      else write(null, false);
    },
  };
}

export function explainHref(key: string): string {
  return `/settings?${PARAM}=${encodeURIComponent(key)}`;
}
