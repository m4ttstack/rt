/**
 * Octokit construction and error translation for GitHubProvider.
 *
 * The provider used a bare fetch before this, which meant no retry, no
 * throttling, pagination that silently truncated on a failed page, and no
 * request instrumentation at all on the GitHub side.
 */
import { Octokit } from '@octokit/core';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { RequestError } from '@octokit/request-error';
import { safeEmit, type OnRequestHook } from './instrumentation.ts';
import type { ForgeLogger } from './logger.ts';

const GlanceOctokitBase = Octokit.plugin(paginateRest, retry, throttling);

export type GlanceOctokit = InstanceType<typeof GlanceOctokitBase>;

/**
 * GitHub Enterprise serves REST under /api/v3 but GraphQL under /api/graphql,
 * not beneath the REST root, so the two cannot be derived from one prefix.
 */
export function resolveGitHubUrls(baseURL: string): {
  apiBase: string;
  graphqlURL: string;
} {
  if (baseURL === 'https://github.com' || baseURL === 'https://www.github.com') {
    return {
      apiBase: 'https://api.github.com',
      graphqlURL: 'https://api.github.com/graphql'
    };
  }
  return {
    apiBase: `${baseURL}/api/v3`,
    graphqlURL: `${baseURL}/api/graphql`
  };
}

export function createGitHubClient(opts: {
  baseURL: string;
  token: string;
  log: ForgeLogger;
  onRequest?: OnRequestHook;
}): GlanceOctokit {
  const { apiBase } = resolveGitHubUrls(opts.baseURL);

  const octokit = new GlanceOctokitBase({
    auth: opts.token,
    baseUrl: apiBase,
    throttle: {
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        opts.log.warn('GitHub rate limit hit', {
          method: options.method,
          url: options.url,
          retryAfter,
          retryCount
        });
        // Two attempts absorb a quota window boundary. Retrying indefinitely
        // would turn a quota exhaustion into a hang with no upper bound.
        return retryCount < 2;
      },
      onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
        opts.log.warn('GitHub secondary rate limit hit', {
          method: options.method,
          url: options.url,
          retryAfter,
          retryCount
        });
        return retryCount < 2;
      }
    }
  });

  if (opts.onRequest) {
    const started = new WeakMap<object, number>();
    octokit.hook.before('request', options => {
      started.set(options, performance.now());
    });
    octokit.hook.after('request', (response, options) => {
      emit(opts.onRequest!, started, options, response.status);
    });
    octokit.hook.error('request', (error, options) => {
      emit(
        opts.onRequest!,
        started,
        options,
        error instanceof RequestError ? error.status : 0
      );
      throw error;
    });
  }

  return octokit;
}

function emit(
  hook: OnRequestHook,
  started: WeakMap<object, number>,
  options: { method?: string; url?: string },
  status: number
): void {
  const at = started.get(options as object);
  safeEmit(hook, {
    op: `gh.${options.method ?? 'GET'} ${options.url ?? ''}`.trim(),
    transport: 'rest',
    method: options.method ?? 'GET',
    path: options.url ?? '',
    durationMs: at === undefined ? 0 : performance.now() - at,
    status
  });
}

/**
 * Translate a thrown Octokit error into the message shape callers already
 * match on.
 *
 * The live conformance harness pattern-matches three of these to distinguish a
 * transient failure from a permanent one, so a reworded message disables a
 * check silently instead of failing it. `style` picks between the two formats
 * the hand-rolled code used: most methods emitted status plus body, five
 * emitted status, statusText, and body.
 */
export function ghError(
  op: string,
  err: unknown,
  style: 'plain' | 'statusText' = 'plain'
): Error {
  if (!(err instanceof RequestError)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  const body = bodyText(err);
  if (style === 'statusText') {
    // The dash here is GitHub-facing text this SDK has always emitted in these
    // five messages, and the harness matches on the prefix before it.
    return new Error(
      `${op} failed: ${err.status} ${statusText(err)}${body ? ` — ${body}` : ''}`
    );
  }
  return new Error(`${op} failed: ${err.status} ${body}`);
}

function bodyText(err: RequestError): string {
  const data = err.response?.data;
  if (data === undefined || data === null) return '';
  return typeof data === 'string' ? data : JSON.stringify(data);
}

function statusText(err: RequestError): string {
  const headers = err.response?.headers as Record<string, unknown> | undefined;
  const fromResponse = headers?.status;
  // GitHub returns "404 Not Found" in its status header; the hand-rolled code
  // read Response.statusText, which is the same text without the code.
  if (typeof fromResponse === 'string') {
    return fromResponse.replace(/^\d+\s*/, '');
  }
  return '';
}
