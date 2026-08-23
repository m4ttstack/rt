import { useEffect } from 'react';

import { Box, SiteShell } from '@ui/core';
import {
  APP_CHROME_HEADER_HEIGHT,
  AppChrome,
  type SiteSection,
} from './chrome/AppChrome';
import { HEADER_HEIGHT, useSiteHeaderProps } from './chrome/layout';
import { SiteFooter } from './chrome/SiteFooter';
import { SiteHeader } from './chrome/SiteHeader';
import { PageShellDemoPage } from './demo/PageShellDemoPage';
import { DocsLayout } from './docs/DocsLayout';
import { LandingPage } from './landing/LandingPage';
import { NotFoundPage } from './NotFoundPage';
import { usePath } from './router/navigation';
import { matchRoute, type AppRoute } from './routes';

/** Which rail chrome section a route belongs to, if any: the docs section,
 * plus not-found paths under a section prefix (which 404 inside the chrome
 * rather than dropping back to the marketing shell -- stale /demo/* deep
 * links land here too, since the live demo route is full-screen). */
function chromeSection(route: AppRoute, path: string): SiteSection | null {
  if (route.name === 'docs') return 'docs';
  if (route.name === 'not-found') {
    if (path.startsWith('/docs/')) return 'docs';
    if (path.startsWith('/demo/')) return 'demo';
  }
  return null;
}

/**
 * The multi-page site: '/' (landing), '/docs/*' (guides plus the
 * per-component reference), '/demo' (the full-screen PageShell showcase),
 * and a not-found fallback -- routed by the hand-rolled history router in
 * ./router (no router dependency).
 *
 * The landing page keeps the marketing chrome (header-only `SiteShell` with
 * the footer pinned to the viewport bottom), while the docs live in
 * `AppChrome`'s mini icon rail -- the deliberate marketing-page vs
 * app-chrome split a real product has. The full-screen PageShell demo
 * bypasses both (it demonstrates the rail pattern standalone).
 */
export function App() {
  const path = usePath();
  const route = matchRoute(path);
  const headerProps = useSiteHeaderProps();

  // Each route change starts at the top of the new page. Hash-only links
  // never reach this effect (Link leaves them to native anchor scrolling and
  // they don't change the pathname), so in-page anchors still work. Chromed
  // sections scroll inside their PageShell content frame instead of the
  // document, and reset by remounting that frame per route.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  // The full-screen PageShell demo brings its own chrome (a mini icon
  // rail app shell), so it bypasses the site chrome entirely.
  if (route.name === 'demo-page-shell') {
    return <PageShellDemoPage />;
  }

  const section = chromeSection(route, path);
  if (section !== null) {
    return (
      <AppChrome section={section}>
        {route.name === 'docs' ? (
          <DocsLayout slug={route.slug} />
        ) : (
          // Chromed 404: AppChrome zeroes AppShell.Main's top padding on
          // the assumption its child clears the fixed header itself (the
          // sections do via PageShell topOffset), so pad here instead.
          <Box pt={APP_CHROME_HEADER_HEIGHT}>
            <NotFoundPage />
          </Box>
        )}
      </AppChrome>
    );
  }

  return (
    <SiteShell
      header={<SiteHeader />}
      headerHeight={HEADER_HEIGHT}
      headerProps={headerProps}
      // Main is a flex column so the footer sits at the viewport bottom even
      // on short pages (AppShell.Main is min-height 100dvh), matching the
      // previous mih=100vh flex-column layout.
      mainProps={{ style: { display: 'flex', flexDirection: 'column' } }}
    >
      <Box style={{ flexGrow: 1 }}>
        {route.name === 'home' ? <LandingPage /> : <NotFoundPage />}
      </Box>
      <SiteFooter />
    </SiteShell>
  );
}
