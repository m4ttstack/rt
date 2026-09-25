import { describe, test, expect } from "bun:test";
import { forgeRole, forgeScopes, missingScopes, tokenCreateLink, tokenField } from "../token-create.ts";

describe("forgeScopes", () => {
  test("gitlab member: read_api already carries git clone, read_user the profile", () => {
    expect(forgeScopes("gitlab", "member")).toEqual(["read_api", "read_user"]);
  });

  test("gitlab owner: api alone covers the push, the members API and everything a member needs", () => {
    expect(forgeScopes("gitlab", "owner")).toEqual(["api"]);
  });

  test("github: the classic scopes, same for both roles", () => {
    expect(forgeScopes("github", "member")).toEqual(["repo", "read:org"]);
    expect(forgeScopes("github", "owner")).toEqual(["repo", "read:org"]);
  });
});

describe("forgeRole", () => {
  test("a create intent is the owner, a join intent a member", () => {
    expect(forgeRole({ intentMode: "create", joinedByRt: false, hasTeam: true })).toBe("owner");
    expect(forgeRole({ intentMode: "join", joinedByRt: false, hasTeam: true })).toBe("member");
  });

  test("after Install clears the intent, the team-local record decides: a joined clone is a member, anything else the owner", () => {
    expect(forgeRole({ intentMode: null, joinedByRt: true, hasTeam: true })).toBe("member");
    expect(forgeRole({ intentMode: null, joinedByRt: false, hasTeam: true })).toBe("owner");
  });

  test("no team at all is a member: nothing to push or sync", () => {
    expect(forgeRole({ intentMode: null, joinedByRt: false, hasTeam: false })).toBe("member");
  });
});

describe("tokenField", () => {
  test("the hint names the role's scopes, comma separated", () => {
    expect(tokenField("gitlab", "owner")).toEqual({ name: "token", label: "GitLab token", secret: true, hint: "api" });
    expect(tokenField("github", "member")).toEqual({ name: "token", label: "GitHub token", secret: true, hint: "repo, read:org" });
  });
});

describe("tokenCreateLink", () => {
  test("gitlab: the new-token page on the given host with name and scopes prefilled", () => {
    expect(tokenCreateLink("gitlab", "member", "gitlab.example.com")).toEqual({
      label: "Create a token on GitLab…",
      url: "https://gitlab.example.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=read_api%2Cread_user",
    });
  });

  test("gitlab with no host: gitlab.com", () => {
    expect(tokenCreateLink("gitlab", "owner", null).url).toBe("https://gitlab.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=api");
  });

  test("github: the classic new-token page, host ignored", () => {
    expect(tokenCreateLink("github", "member", "ghe.example.com")).toEqual({
      label: "Create a token on GitHub…",
      url: "https://github.com/settings/tokens/new?description=mattstack&scopes=repo%2Cread%3Aorg",
    });
  });
});

describe("missingScopes", () => {
  test("names each required scope the token lacks", () => {
    expect(missingScopes("gitlab", "owner", ["read_api", "read_user"])).toEqual(["api"]);
    expect(missingScopes("gitlab", "member", ["read_user"])).toEqual(["read_api"]);
  });

  test("a broader scope satisfies the narrower one it contains", () => {
    expect(missingScopes("gitlab", "member", ["api"])).toEqual([]);
    expect(missingScopes("gitlab", "member", ["read_api"])).toEqual([]);
    expect(missingScopes("github", "member", ["repo", "admin:org"])).toEqual([]);
  });

  test("no scopes reported (a fine-grained GitHub token) is not a shortfall", () => {
    expect(missingScopes("github", "member", [])).toEqual([]);
  });
});
