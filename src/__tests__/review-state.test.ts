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
  pruneReviewStates,
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
  test("maps every state by mrUrl, regardless of age (no age pruning)", () => {
    writeReviewState(reviewFilePath(URL_A, dir), { mrUrl: URL_A, iid: 4821, status: "reviewing" }, 10_000);
    // An old file is NOT pruned on read — retention is by board membership now.
    const oldUrl = "https://gitlab.com/acme/webapp/-/merge_requests/1";
    const oldPath = reviewFilePath(oldUrl, dir);
    writeFileSync(oldPath, JSON.stringify({ mrUrl: oldUrl, iid: 1, status: "done", startedAt: 0, updatedAt: 0 }));
    const map = readReviewStates(dir);
    expect(map.get(URL_A)?.status).toBe("reviewing");
    expect(map.has(oldUrl)).toBe(true);
    expect(existsSync(oldPath)).toBe(true); // still on disk
  });

  test("returns empty map when dir is missing", () => {
    expect(readReviewStates(join(dir, "nope")).size).toBe(0);
  });
});

describe("pruneReviewStates", () => {
  const OTHER = "https://gitlab.com/acme/webapp/-/merge_requests/1";
  test("keeps states whose MR is on the board, deletes the rest (and their reports)", () => {
    writeReviewState(reviewFilePath(URL_A, dir), { mrUrl: URL_A, iid: 4821, status: "done" });
    writeFileSync(reviewReportPath(reviewFilePath(URL_A, dir)), "# review A");
    writeReviewState(reviewFilePath(OTHER, dir), { mrUrl: OTHER, iid: 1, status: "done" });
    writeFileSync(reviewReportPath(reviewFilePath(OTHER, dir)), "# review OTHER");

    pruneReviewStates(new Set([URL_A]), dir); // only URL_A still on the board

    expect(existsSync(reviewFilePath(URL_A, dir))).toBe(true);
    expect(existsSync(reviewReportPath(reviewFilePath(URL_A, dir)))).toBe(true);
    expect(existsSync(reviewFilePath(OTHER, dir))).toBe(false); // pruned
    expect(existsSync(reviewReportPath(reviewFilePath(OTHER, dir)))).toBe(false); // report gone too
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
    expect(readReviewStates(dir).get(URL_A)?.reportReady).toBe(false);
    writeFileSync(reviewReportPath(p), "# Review");
    expect(readReviewStates(dir).get(URL_A)?.reportReady).toBe(true);
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
