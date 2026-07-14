import { writeReviewState, type ReviewStatus } from "../src/review-state.ts";

const VALID: ReviewStatus[] = ["queued", "reviewing", "done", "error"];

const [path, status, ...rest] = process.argv.slice(2);
const message = rest.join(" ").trim();

if (!path || !status || !VALID.includes(status as ReviewStatus)) {
  console.error(`usage: review-status <statePath> <${VALID.join("|")}> [message]`);
  process.exit(1);
}

writeReviewState(path, { status: status as ReviewStatus, ...(message ? { message } : {}) });
