import { useQuery } from '@tanstack/react-query';

import { client } from './api';

/** Keys are `rt code` editor ids; only editors with a `<scheme>://file/<abs
    path>` URL form appear here. Anything else falls back to vscode. */
const SCHEME_BY_ID: Record<string, string> = {
  code: 'vscode',
  cursor: 'cursor',
  zed: 'zed',
  codium: 'vscodium',
  windsurf: 'windsurf',
};

const SCHEME_BY_APP_LABEL: Record<string, string> = {
  'visual studio code': 'vscode',
  cursor: 'cursor',
  zed: 'zed',
  vscodium: 'vscodium',
  windsurf: 'windsurf',
};

/**
 * The URL scheme for an rt.workspacePrefs.defaultEditor value — an editor id
 * ("zed") or a full launch command (`open -a "Zed"`), the two forms `rt code`
 * accepts.
 */
export function editorScheme(editor: string | null | undefined): string {
  if (!editor || typeof editor !== 'string') return 'vscode';
  const direct = SCHEME_BY_ID[editor.trim().toLowerCase()];
  if (direct) return direct;
  const appLabel = editor.match(/^open\s+-a\s+"(.+)"\s*$/)?.[1];
  return (appLabel && SCHEME_BY_APP_LABEL[appLabel.toLowerCase()]) || 'vscode';
}

/**
 * Builds `scheme://file<absPath>` hrefs from the suite-wide editor
 * preference. Until the preference loads (or when the fetch fails), hrefs
 * use the vscode fallback — a link is never withheld on a pending query.
 */
export function useEditorHref(): (absPath: string) => string {
  const query = useQuery({
    queryKey: ['settings', 'default-editor'],
    queryFn: async () => {
      const res = await client.api.settings['default-editor'].$get();
      if (!res.ok) throw new Error(`default-editor failed: ${res.status}`);
      return res.json();
    },
    // A machine-level preference: static per server process, like defs.
    staleTime: Infinity,
    retry: false,
  });
  const scheme = editorScheme(query.data?.editor);
  return absPath => `${scheme}://file${absPath}`;
}
