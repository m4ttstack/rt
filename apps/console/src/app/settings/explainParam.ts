import { useSearchParams } from 'wouter';

const PARAM = 'explain';

/** The key whose explain modal is open on /settings, kept in `?explain=` so
    a reload or a shared link reopens it. */
export function useExplainParam() {
  const [params, setParams] = useSearchParams();
  const write = (key: string | null, push: boolean) =>
    setParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (key) next.set(PARAM, key);
        else next.delete(PARAM);
        return next;
      },
      push ? { state: { [PARAM]: true } } : { replace: true }
    );
  return {
    key: params.get(PARAM),
    // Opening pushes so Back closes the modal before it leaves the page;
    // closing an entry we pushed pops it, so no duplicate is left behind.
    open: (key: string) => write(key, true),
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
