import { DEMO_PATH, PAGE_SHELL_DEMO_PATH } from './demo/paths';
import { isDocsSlug, type DocsSlug } from './docs/docsNav';
import { matchPath } from './router/matchPath';

export type AppRoute =
  | { name: 'home' }
  | { name: 'docs'; slug: DocsSlug }
  | { name: 'demo-page-shell' }
  | { name: 'not-found' };

/**
 * The app's route table: pathname in, structured route out. Params are
 * validated against the closed slug union here, so an unknown docs topic
 * falls through to not-found instead of rendering an empty shell.
 */
export function matchRoute(pathname: string): AppRoute {
  if (matchPath('/', pathname)) return { name: 'home' };

  if (matchPath('/docs', pathname)) return { name: 'docs', slug: '' };
  const docs = matchPath('/docs/:slug', pathname);
  if (docs && isDocsSlug(docs.slug)) return { name: 'docs', slug: docs.slug };
  // Component and hook reference pages sit one level deeper: their DocsSlug
  // is the composite 'components/<name>' / 'hooks/<name>', validated against
  // the same closed union.
  const component = matchPath('/docs/components/:slug', pathname);
  if (component) {
    const slug = `components/${component.slug}`;
    if (isDocsSlug(slug)) return { name: 'docs', slug };
  }
  const hook = matchPath('/docs/hooks/:slug', pathname);
  if (hook) {
    const slug = `hooks/${hook.slug}`;
    if (isDocsSlug(slug)) return { name: 'docs', slug };
  }

  // The full-screen PageShell showcase is the whole demo section: '/demo'
  // renders it directly (no redirect machinery in the hand-rolled router)
  // and PAGE_SHELL_DEMO_PATH stays the canonical deep-link path. Any other
  // /demo/* path (including the retired dashboard/forms/lists screens)
  // falls through to the chromed not-found.
  if (
    matchPath(DEMO_PATH, pathname) ||
    matchPath(PAGE_SHELL_DEMO_PATH, pathname)
  ) {
    return { name: 'demo-page-shell' };
  }

  return { name: 'not-found' };
}
