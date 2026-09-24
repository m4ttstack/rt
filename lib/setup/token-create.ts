/**
 * The token scopes rt needs on each forge, and the forge's own new-token page
 * with them pre-checked. One list feeds the Connect sheet's hint, the create
 * link and the post-paste check, so the three can never disagree.
 *
 * GitLab's `read_api` does not cover git over HTTPS: the private clone needs
 * `read_repository`, the owner's push `write_repository`, and the owner's
 * members-sync posts to the API, which needs `api`. GitHub's classic `repo`
 * covers clone, push and the API together.
 */

import type { ConnectField } from "./contract.ts";

export type ForgeProvider = "github" | "gitlab";
export type ForgeRole = "owner" | "member";

const SCOPES: Record<ForgeProvider, Record<ForgeRole, readonly string[]>> = {
  github: { owner: ["repo", "read:org"], member: ["repo", "read:org"] },
  gitlab: { owner: ["api", "read_user", "write_repository"], member: ["read_api", "read_user", "read_repository"] },
};

/** A scope a token holds on the left satisfies every scope on the right. */
const IMPLIES: Record<string, readonly string[]> = {
  api: ["read_api", "read_user"],
  read_api: ["read_user"],
  write_repository: ["read_repository"],
  "admin:org": ["write:org", "read:org"],
  "write:org": ["read:org"],
};

const TITLES: Record<ForgeProvider, string> = { github: "GitHub", gitlab: "GitLab" };
const TOKEN_NAME = "mattstack";

export function forgeScopes(provider: ForgeProvider, role: ForgeRole): string[] {
  return [...SCOPES[provider][role]];
}

export function tokenField(provider: ForgeProvider, role: ForgeRole): ConnectField {
  return { name: "token", label: `${TITLES[provider]} token`, secret: true, hint: forgeScopes(provider, role).join(", ") };
}

/** GitHub's link is always github.com: rt's validator dials api.github.com only, so GHE never holds a token here. */
export function tokenCreateLink(provider: ForgeProvider, role: ForgeRole, host: string | null): { label: string; url: string } {
  const scopes = forgeScopes(provider, role).join(",");
  const params: Record<string, string> = provider === "github" ? { description: TOKEN_NAME, scopes } : { name: TOKEN_NAME, scopes };
  const query = new URLSearchParams(params).toString();
  const page = provider === "github" ? "https://github.com/settings/tokens/new" : `https://${host ?? "gitlab.com"}/-/user_settings/personal_access_tokens`;
  return { label: `Create a token on ${TITLES[provider]}…`, url: `${page}?${query}` };
}

/** Empty when the forge reported no scopes at all: a fine-grained GitHub token sends none, and silence is not a shortfall. */
export function missingScopes(provider: ForgeProvider, role: ForgeRole, scopesSeen: readonly string[]): string[] {
  if (scopesSeen.length === 0) return [];
  const held = new Set<string>();
  for (const scope of scopesSeen) {
    held.add(scope);
    for (const implied of IMPLIES[scope] ?? []) held.add(implied);
  }
  return forgeScopes(provider, role).filter((scope) => !held.has(scope));
}
