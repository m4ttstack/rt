#!/usr/bin/env bun
/**
 * fetchDownstreamPipeline through the widened interface (MAT-155).
 *
 * The defect was structural: GitLabProvider's implementation always took
 * `pipelineId`, but `GitProvider.fetchDownstreamPipeline` did not declare it,
 * so an interface-typed caller could never reach the /bridges fallback and a
 * genuine bridge job resolved to null. These tests drive the call through a
 * `GitProvider`-typed reference on purpose: they fail to compile if the
 * interface ever narrows again.
 */
import { describe, expect, test } from "bun:test";
import type { GitProvider } from "../src/GitProvider.ts";
import { GitLabProvider } from "../src/GitLabProvider.ts";
import { GitHubProvider } from "../src/GitHubProvider.ts";

const DOWNSTREAM = {
  id: 555,
  status: "success",
  created_at: "2026-08-06T00:00:00Z",
  web_url: "https://gitlab.example.com/x/-/pipelines/555",
};

/** A GitLab where job 42 is a bridge: /jobs/:id 404s, /bridges lists it. */
function bridgeProvider(): GitProvider {
  const provider = new GitLabProvider("https://gitlab.example.com", "tok");
  (provider as any).gb.Jobs.show = async () => {
    throw Object.assign(new Error("404 Not Found"), { cause: { response: { status: 404 } } });
  };
  (provider as any).gb.Jobs.allPipelineBridges = async (_path: string, pipelineId: number) => {
    if (pipelineId !== 900) return [];
    return [{ id: 42, downstream_pipeline: DOWNSTREAM }];
  };
  (provider as any).gb.Jobs.all = async () => [
    { id: 1, name: "child-job", stage: "test", status: "success", allow_failure: false, duration: 3.2, web_url: null },
  ];
  return provider;
}

describe("GitProvider.fetchDownstreamPipeline with pipelineId", () => {
  test("an interface-typed caller can resolve a bridge job's child pipeline", async () => {
    const provider = bridgeProvider();
    const pipeline = await provider.fetchDownstreamPipeline("acme/repo", 42, 900);
    expect(pipeline).not.toBeNull();
    expect(pipeline!.id).toBe("gitlab:pipeline:555");
    expect(pipeline!.status).toBe("success");
    expect(pipeline!.jobs).toEqual([
      { id: "gitlab:job:1", name: "child-job", stage: "test", status: "success", allowFailure: false, duration: 3, webUrl: null },
    ]);
  });

  test("without pipelineId the bridges fallback stays unreachable, the pre-MAT-155 behavior", async () => {
    const provider = bridgeProvider();
    expect(await provider.fetchDownstreamPipeline("acme/repo", 42)).toBeNull();
  });

  test("GitHub accepts the widened signature and still answers null", async () => {
    const provider: GitProvider = new GitHubProvider("https://github.com", "tok");
    expect(await provider.fetchDownstreamPipeline("acme/repo", 42, 900)).toBeNull();
  });
});
