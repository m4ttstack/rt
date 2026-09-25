/**
 * The token scopes rt needs on each forge, and the forge's own new-token page
 * with them pre-checked. One list feeds the Connect sheet's hint, the create
 * link and the scope check, so the three can never disagree.
 *
 * GitLab grants git abilities through API scopes (lib/gitlab/auth.rb):
 * `read_api` carries download_code, so a member's clone needs nothing beyond
 * it; `api` carries push_code and the members API, which is what the owner's
 * home-repo push and `rt team members sync` do. GitHub's classic `repo`
 * covers clone, push and the API together.
 */

import type { ConnectField } from "./contract.ts";

export type ForgeProvider = "github" | "gitlab";
export type ForgeRole = "owner" | "member";

const SCOPES: Record<ForgeProvider, Record<ForgeRole, readonly string[]>> = {
  github: { owner: ["repo", "read:org"], member: ["repo", "read:org"] },
  gitlab: { owner: ["api"], member: ["read_api", "read_user"] },
};

/** A scope a token holds on the left satisfies every scope on the right. */
const IMPLIES: Record<string, readonly string[]> = {
  api: ["read_api", "read_user"],
  read_api: ["read_user"],
  "admin:org": ["write:org", "read:org"],
  "write:org": ["read:org"],
};

const TITLES: Record<ForgeProvider, string> = { github: "GitHub", gitlab: "GitLab" };
const TOKEN_NAME = "mattstack";

/**
 * Install clears the setup intent, so a reconnect after it has only the
 * team-local record to go on: a clone rt joined is a member's, any other
 * team on the machine is the owner's. No team means nothing to push or sync.
 */
export function forgeRole(input: { intentMode: string | null; joinedByRt: boolean; hasTeam: boolean }): ForgeRole {
  if (input.intentMode === "create") return "owner";
  if (input.intentMode === "join") return "member";
  return input.hasTeam && !input.joinedByRt ? "owner" : "member";
}

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
