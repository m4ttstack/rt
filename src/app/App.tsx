import { Component, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { GenericError, PageShell, Text } from '@ui/core';
import { ConsoleChrome, type ConsoleSection } from './chrome/ConsoleChrome';
import { NotFoundPage } from './NotFoundPage';
import { usePath } from './router/navigation';
import { matchRoute, type AppRoute } from './routes';
import { RunBoard } from './runs/RunBoard';
import { RunDetail } from './runs/RunDetail';

const queryClient = new QueryClient();

function chromeSection(route: AppRoute): ConsoleSection | null {
  if (route.name === 'search') return 'search';
  if (route.name === 'not-found') return null;
  return 'runs';
}

/**
 * Mantine has no error boundary of its own, and a suspense query (run
 * detail, arriving in a later task) throws on failure -- one boundary here
 * keeps a bad query from blanking the whole console instead of just its route.
 */
class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <GenericError
          title="This page hit a snag"
          message={this.state.error.message}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

function RouteContent({ route }: { route: AppRoute }) {
  switch (route.name) {
    case 'board':
      return <RunBoard />;
    case 'run':
      return <RunDetail repo={route.repo} runId={route.runId} />;
    case 'search':
      return (
        <PageShell title="Search">
          <Text c="dimmed">Run search arrives in a later task.</Text>
        </PageShell>
      );
    case 'not-found':
      return (
        <PageShell>
          <NotFoundPage />
        </PageShell>
      );
  }
}

/**
 * The console's whole client shell: one `QueryClientProvider` over the app,
 * one `ConsoleChrome` hosting the route switch, and a route-level error
 * boundary between them so a thrown query doesn't take the rail with it.
 */
export function App() {
  const path = usePath();
  const route = matchRoute(path);

  return (
    <QueryClientProvider client={queryClient}>
      <ConsoleChrome section={chromeSection(route)}>
        {/* Keyed on path: without a remount, an error caught on one route
            would keep showing the fallback after navigating to another. */}
        <RouteErrorBoundary key={path}>
          <RouteContent route={route} />
        </RouteErrorBoundary>
      </ConsoleChrome>
    </QueryClientProvider>
  );
}
