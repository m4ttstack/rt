import { useState, useEffect, useMemo } from 'react';
import { createDashboard } from '@workforge/glance-sdk';
import type {
  GitProvider,
  MRDashboardActions,
  MRDashboardProps,
  WatcherStatus
} from '@workforge/glance-sdk';

export interface UseDashboardOptions {
  provider: GitProvider;
  projectPath: string;
  /** MR IID — mutually exclusive with `branch`. */
  mrIid?: number;
  /** Source branch name — resolves IID automatically. Mutually exclusive with `mrIid`. */
  branch?: string;
  userId: number | null;
}

/** Connection status exposed to the UI layer. */
export type ConnectionStatus = WatcherStatus['connection'];

export interface UseDashboardResult {
  /** Render-ready MR props. Null until first data arrives. */
  mr: MRDashboardProps | null;
  /** Pre-bound mutation methods. Null until MR is resolved (branch-based dashboards). */
  actions: MRDashboardActions | null;
  /** True before the first data payload arrives — use to render skeletons. */
  isInitialLoading: boolean;
  /** WebSocket / push connection state. */
  connectionStatus: ConnectionStatus;
  /** Last error from the realtime watcher, if any. Null when healthy. */
  error: Error | null;
}

/**
 * React hook that wraps `createDashboard` — returns live MR data, actions,
 * and connection lifecycle state.
 *
 * @example
 * const { mr, actions, isInitialLoading, connectionStatus, error } = useDashboard({
 *   provider, projectPath: 'group/project', mrIid: 42, userId
 * });
 *
 * if (isInitialLoading) return <MRCard loading />;
 * if (error) return <MRCardError error={error} />;
 * return <MRCard mr={mr!} actions={actions!} />;
 */
export function useDashboard(options: UseDashboardOptions): UseDashboardResult {
  const { provider, projectPath, mrIid, branch, userId } = options;

  const dashboard = useMemo(
    () => {
      if (branch) {
        return createDashboard({ provider, projectPath, branch, userId });
      }
      return createDashboard({ provider, projectPath, mrIid: mrIid!, userId });
    },
    [provider, projectPath, mrIid, branch, userId]
  );

  const [mr, setMr] = useState<MRDashboardProps | null>(null);
  const [actions, setActions] = useState<MRDashboardActions | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setConnectionStatus('connecting');
    setMr(null);
    setError(null);

    dashboard.onStatusChange((status) => {
      setConnectionStatus(status.connection);
      setError(status.lastError ?? null);
    });

    dashboard.subscribe((props) => {
      setMr(props);
      // For branch-based dashboards, actions resolve lazily after first fetch.
      // Re-read actions on each update to capture when they become available.
      try {
        setActions(dashboard.actions);
      } catch {
        // actions not yet available (branch not resolved)
      }
    });

    // For IID-based dashboards, actions are available immediately
    try {
      setActions(dashboard.actions);
    } catch {
      // branch-based — will set on first update
    }

    return () => dashboard.dispose();
  }, [dashboard]);

  return {
    mr,
    actions,
    isInitialLoading: dashboard.isInitialLoading,
    connectionStatus,
    error,
  };
}
