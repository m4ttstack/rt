/**
 * Provider factory (Phase C1).
 *
 * Creates the correct GitProvider implementation based on the provider slug
 * from `connected_accounts.provider`.
 */

import type { GitProvider } from "./GitProvider.ts";
import { GitLabProvider } from "./GitLabProvider.ts";
import { GitHubProvider } from "./GitHubProvider.ts";
import type { ForgeLogger } from "./logger.ts";

/**
 * Create a GitProvider for the given provider slug.
 *
 * @param provider - The provider slug from the DB, e.g. "gitlab" or "github".
 * @param baseURL  - The base URL for the provider instance.
 * @param token    - The decrypted PAT for the provider.
 * @returns A GitProvider implementation.
 * @throws If the provider slug is unknown.
 */
export function createProvider(
  provider: string,
  baseURL: string,
  token: string,
  options: { logger?: ForgeLogger } = {},
): GitProvider {
  switch (provider) {
    case "gitlab":
      return new GitLabProvider(baseURL, token, options);
    case "github":
      return new GitHubProvider(baseURL, token, options);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/** List of all supported provider slugs. */
export const SUPPORTED_PROVIDERS = ["gitlab", "github"] as const;
export type ProviderSlug = (typeof SUPPORTED_PROVIDERS)[number];
