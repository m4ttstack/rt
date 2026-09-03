import { GitLabProvider } from "@mattstack/glance";
import type {
  FetchMergeRequestIndexOptions,
  FetchMergeRequestMetricsOptions,
  FetchProjectOptions,
  FetchProjectPipelinesOptions,
  FetchUserEventsOptions,
  GitProvider,
  MergeRequestIndexRow,
  MergeRequestMetrics,
  PipelineSummary,
  ProjectRef,
  UserEvent,
} from "@mattstack/glance";
import type { Env } from "../config/index.js";

export type { GitProvider };

/** Abort plumbing every fetcher in this module accepts. */
export type SourceIO = { signal?: AbortSignal };

/** What `restRequest` accepts beyond method/path/body. */
export interface RequestIO {
  signal?: AbortSignal;
  retry?: boolean;
}

/**
 * The slice of GitProvider this module calls, with those methods required
 * instead of the interface's optional (GitHub does not implement all of
 * them). Narrow on purpose: the hand-rolled fake in tests only needs to
 * implement this, not GitProvider's full mutation surface.
 */
export interface SourceProvider {
  fetchMergeRequestIndex(options: FetchMergeRequestIndexOptions): Promise<MergeRequestIndexRow[]>;
  fetchMergeRequestMetrics(
    projectPath: string,
    mrIid: number,
    options?: FetchMergeRequestMetricsOptions,
  ): Promise<MergeRequestMetrics | null>;
  fetchProject(projectPath: string, options?: FetchProjectOptions): Promise<ProjectRef | null>;
  fetchProjectPipelines(projectPath: string, options: FetchProjectPipelinesOptions): Promise<PipelineSummary[]>;
  fetchUserEvents(userId: string, options: FetchUserEventsOptions): Promise<UserEvent[]>;
  restRequest(method: string, path: string, body?: unknown, op?: string, io?: RequestIO): Promise<Response>;
}

export function makeProvider(env: Env): GitProvider {
  return new GitLabProvider(env.baseUrl, env.token);
}
