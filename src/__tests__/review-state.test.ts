import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  reviewFilePath,
  reviewReportPath,
  readReviewReport,
  writeReviewState,
  readReviewStates,
  parseReviewRequestBody,
  attachReviews,
} from "../review-state.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rs-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const URL_A = "https://gitlab.com/acme/webapp/-/merge_requests/4821";

describe("reviewFilePath", () => {
  test("is deterministic and lives under the dir", () => {
    expect(reviewFilePath(URL_A, dir)).toBe(reviewFilePath(URL_A, dir));
    expect(reviewFilePath(URL_A, dir).startsWith(dir)).toBe(true);
    expect(reviewFilePath(URL_A, dir).endsWith(".json")).toBe(true);
  });
});

describe("writeReviewState", () => {
  test("creates a file, sets startedAt on first write, merges on second", () => {
    const p = reviewFilePath(URL_A, dir);
    const first = writeReviewState(p, { mrUrl: URL_A, iid: 4821, status: "queued", tabId: "w9:t2" }, 1000);
    expect(first.startedAt).toBe(1000);
    expect(first.status).toBe("queued");
    const second = writeReviewState(p, { status: "reviewing" }, 2000);
    expect(second.startedAt).toBe(1000);        // preserved
    expect(second.updatedAt).toBe(2000);        // advanced
    expect(second.tabId).toBe("w9:t2");         // preserved
    expect(second.mrUrl).toBe(URL_A);           // preserved
    expect(second.status).toBe("reviewing");
  });
});

describe("readReviewStates", () => {
  test("maps by mrUrl and prunes stale files", () => {
    writeReviewState(reviewFilePath(URL_A, dir), { mrUrl: URL_A, iid: 4821, status: "reviewing" }, 10_000);
    // A stale file older than the max age is pruned and excluded.
    const staleUrl = "https://gitlab.com/acme/webapp/-/merge_requests/1";
    const stalePath = reviewFilePath(staleUrl, dir);
    writeFileSync(stalePath, JSON.stringify({ mrUrl: staleUrl, iid: 1, status: "done", startedAt: 0, updatedAt: 0 }));
    const map = readReviewStates(dir, 10_000, 5_000);
    expect(map.get(URL_A)?.status).toBe("reviewing");
    expect(map.has(staleUrl)).toBe(false);
    expect(existsSync(stalePath)).toBe(false); // pruned from disk
  });

  test("returns empty map when dir is missing", () => {
    expect(readReviewStates(join(dir, "nope")).size).toBe(0);
  });
});

describe("review report", () => {
  test("reportPath is the state path with a .md extension", () => {
    expect(reviewReportPath(reviewFilePath(URL_A, dir))).toBe(reviewFilePath(URL_A, dir).replace(/\.json$/, ".md"));
    expect(reviewReportPath("/s/1.json")).toBe("/s/1.md");
  });

  test("readReviewReport returns the saved markdown, or null when absent", () => {
    expect(readReviewReport(URL_A, dir)).toBeNull();
    writeFileSync(reviewReportPath(reviewFilePath(URL_A, dir)), "# Review\n\nlooks good");
    expect(readReviewReport(URL_A, dir)).toBe("# Review\n\nlooks good");
  });

  test("readReviewStates flags reportReady when the sibling .md exists", () => {
    const p = reviewFilePath(URL_A, dir);
    writeReviewState(p, { mrUrl: URL_A, iid: 4821, status: "done" }, 10_000);
    expect(readReviewStates(dir, 10_000).get(URL_A)?.reportReady).toBe(false);
    writeFileSync(reviewReportPath(p), "# Review");
    expect(readReviewStates(dir, 10_000).get(URL_A)?.reportReady).toBe(true);
  });
});

describe("parseReviewRequestBody", () => {
  test("accepts a well-formed body", () => {
    expect(parseReviewRequestBody({ mrUrl: URL_A, iid: 4821 })).toEqual({ mrUrl: URL_A, iid: 4821 });
  });
  test("rejects bad shapes", () => {
    expect(parseReviewRequestBody({ mrUrl: URL_A })).toBeNull();
    expect(parseReviewRequestBody({ mrUrl: 5, iid: 1 })).toBeNull();
    expect(parseReviewRequestBody(null)).toBeNull();
  });
});

describe("attachReviews", () => {
  test("attaches review by webUrl, leaves others untouched", () => {
    const reviews = new Map([[URL_A, { mrUrl: URL_A, iid: 4821, status: "reviewing" as const, startedAt: 0, updatedAt: 0 }]]);
    const [a, b] = attachReviews([{ webUrl: URL_A }, { webUrl: "https://other/mr/9" }], reviews);
    expect(a.review?.status).toBe("reviewing");
    expect(b.review).toBeUndefined();
  });
});
