/**
 * The latch's GitLab writes, behind one injected gateway so the pass and the
 * server share them and tests need no network.
 */
import { latchBannerPng } from "./banner.ts";
import { armedLatchBody, imageMarkdownOf, spentLatchBody } from "./markers.ts";
import type { LatchRef } from "./discussions.ts";

export interface LatchGateway {
  uploadFile(
    projectId: number,
    filename: string,
    bytes: Uint8Array,
    contentType?: string,
  ): Promise<{ markdown: string; url: string; alt: string; full_path: string }>;
  createDiscussion(
    projectId: number,
    mrIid: number,
    body: string,
  ): Promise<{ id: string; notes: { id: number }[] }>;
  updateNote(projectId: number, mrIid: number, noteId: number, body: string): Promise<void>;
  resolveDiscussion(projectPath: string, mrIid: number, discussionId: string): Promise<void>;
  unresolveDiscussion(projectPath: string, mrIid: number, discussionId: string): Promise<void>;
  createNote(
    projectId: number,
    mrIid: number,
    body: string,
    discussionId?: string,
  ): Promise<{ id: number }>;
}

/** Arm a fresh latch: upload this MR's banner, then open a resolvable thread. */
export async function postLatch(
  gw: LatchGateway,
  projectId: number,
  _projectPath: string,
  mrUrl: string,
  iid: number,
): Promise<void> {
  const png = latchBannerPng(mrUrl);
  const up = await gw.uploadFile(projectId, `latch-${iid}.png`, png, "image/png");
  await gw.createDiscussion(projectId, iid, armedLatchBody(up.markdown));
}

/**
 * Terminal disposal: rewrite the body to the spent form, then resolve.
 *
 * Ordered rewrite-first deliberately. A crash between the two calls leaves a
 * spent-but-unresolved latch, which the pass repairs by re-resolving. The
 * reverse order leaves a resolved-but-unspent latch, which reads as a human
 * request and costs a dispatch nobody asked for.
 */
export async function spendLatch(
  gw: LatchGateway,
  projectId: number,
  projectPath: string,
  iid: number,
  latch: LatchRef,
  rootNoteId: number = latch.rootNoteId,
): Promise<void> {
  if (latch.kind === "spent") {
    // Idempotent: an already-spent latch is left alone, except for the crash
    // residue where the body was written but the resolve never landed.
    if (!latch.resolved) await gw.resolveDiscussion(projectPath, iid, latch.discussionId);
    return;
  }
  const img = imageMarkdownOf(latch.body);
  const body = spentLatchBody(img ?? "");
  await gw.updateNote(projectId, iid, rootNoteId, body);
  await gw.resolveDiscussion(projectPath, iid, latch.discussionId);
}
