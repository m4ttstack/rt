import { describe, test, expect } from "bun:test";
import { forgeScopes, missingScopes, tokenCreateLink, tokenField } from "../token-create.ts";

describe("forgeScopes", () => {
  test("gitlab member: the read set git clone and the API both need", () => {
    expect(forgeScopes("gitlab", "member")).toEqual(["read_api", "read_user", "read_repository"]);
  });

  test("gitlab owner: write access for the members API and the home-repo push", () => {
    expect(forgeScopes("gitlab", "owner")).toEqual(["api", "read_user", "write_repository"]);
  });

  test("github: the classic scopes, same for both roles", () => {
    expect(forgeScopes("github", "member")).toEqual(["repo", "read:org"]);
    expect(forgeScopes("github", "owner")).toEqual(["repo", "read:org"]);
  });
});

describe("tokenField", () => {
  test("the hint names the role's scopes, comma separated", () => {
    expect(tokenField("gitlab", "owner")).toEqual({ name: "token", label: "GitLab token", secret: true, hint: "api, read_user, write_repository" });
    expect(tokenField("github", "member")).toEqual({ name: "token", label: "GitHub token", secret: true, hint: "repo, read:org" });
  });
});

describe("tokenCreateLink", () => {
  test("gitlab: the new-token page on the given host with name and scopes prefilled", () => {
    expect(tokenCreateLink("gitlab", "member", "gitlab.example.com")).toEqual({
      label: "Create a token on GitLab…",
      url: "https://gitlab.example.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=read_api%2Cread_user%2Cread_repository",
    });
  });

  test("gitlab with no confirmed host: gitlab.com", () => {
    expect(tokenCreateLink("gitlab", "owner", null).url).toBe(
      "https://gitlab.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=api%2Cread_user%2Cwrite_repository",
    );
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
    expect(missingScopes("gitlab", "member", ["read_api", "read_user"])).toEqual(["read_repository"]);
  });

  test("a broader scope satisfies the narrower one it contains", () => {
    expect(missingScopes("gitlab", "member", ["api", "write_repository"])).toEqual([]);
    expect(missingScopes("github", "member", ["repo", "admin:org"])).toEqual([]);
  });

  test("api does not stand in for repository access", () => {
    expect(missingScopes("gitlab", "member", ["api"])).toEqual(["read_repository"]);
  });

  test("no scopes reported (a fine-grained GitHub token) is not a shortfall", () => {
    expect(missingScopes("github", "member", [])).toEqual([]);
  });
});
