import { describe, expect, test } from "bun:test";
import { forgeTokenFor } from "../enrich.ts";

describe("forgeTokenFor", () => {
  test("a GitLab remote reads the stored gitlabToken", async () => {
    expect(await forgeTokenFor("git@gitlab.com:team/repo.git", { gitlabToken: "glpat" })).toEqual({ forge: "gitlab", token: "glpat" });
  });

  test("a GitLab remote with no token names the gap", async () => {
    expect(await forgeTokenFor("https://gitlab.com/team/repo.git", {})).toEqual({ forge: "gitlab", token: null });
  });

  test("a GitHub remote prefers the stored githubToken", async () => {
    expect(await forgeTokenFor("https://github.com/o/r.git", { githubToken: "ghp" })).toEqual({ forge: "github", token: "ghp" });
  });

  test("a GitHub remote with no token and no gh session names the gap", async () => {
    expect(await forgeTokenFor("git@github.com:o/r.git", {})).toEqual({ forge: "github", token: null });
  });

  test("a remote on neither forge is null", async () => {
    expect(await forgeTokenFor("https://example.com/o/r.git", { githubToken: "ghp" })).toBeNull();
    expect(await forgeTokenFor(undefined, {})).toBeNull();
  });
});
