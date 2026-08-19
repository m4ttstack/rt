import { test, expect } from "bun:test";
import { postAction } from "../client/api.ts";
import { runLaunchFlow } from "../client/board/hooks.ts";

test("postAction returns typed non-ok without throwing", async () => {
  const r = await postAction("/x", {}, (async () => new Response("nope", { status: 502 })) as unknown as typeof fetch);
  expect(r).toMatchObject({ ok: false, status: 502, text: "nope" });
});
test("postAction swallows network errors as status 0", async () => {
  const r = await postAction("/x", {}, (async () => { throw new Error("down"); }) as unknown as typeof fetch);
  expect(r).toMatchObject({ ok: false, status: 0, body: null });
});
test("launch flow: ok path toasts launch then focused, reloads, no rollback", async () => {
  const events: string[] = [];
  await runLaunchFlow({
    post: async () => ({ ok: true, status: 200, body: { focused: true }, text: "" }),
    setQueued: () => events.push("queued"), rollback: () => events.push("rollback"),
    addToast: (t) => events.push(`toast:${t}`), reload: () => events.push("reload"),
    verbing: "launching review", noun: "review",
  }, { webUrl: "u", iid: 7 } as never, {});
  expect(events).toEqual(["queued", "toast:launching review for !7…", "toast:review already running for !7 — focused its tab", "reload"]);
});
test("launch flow: non-ok rolls back and toasts the status", async () => {
  const events: string[] = [];
  await runLaunchFlow({
    post: async () => ({ ok: false, status: 502, body: null, text: "" }),
    setQueued: () => events.push("queued"), rollback: () => events.push("rollback"),
    addToast: (t) => events.push(`toast:${t}`), reload: () => events.push("reload"),
    verbing: "launching review", noun: "review",
  }, { webUrl: "u", iid: 7 } as never, {});
  expect(events).toEqual(["queued", "toast:launching review for !7…", "rollback", "toast:couldn't launch review for !7 (502)"]);
});
