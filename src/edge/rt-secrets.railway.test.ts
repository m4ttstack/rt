import { expect, test } from "bun:test";
import { readDeckSecrets } from "./rt-secrets.ts";

test("railwayToken surfaces on the ok branch", async () => {
  const res = await readDeckSecrets({
    readApiToken: () => "tok",
    post: async () => ({ ok: true, data: { cfApiToken: "cf", cfZoneId: "z", railwayToken: "rw" } }) as any,
  });
  expect(res).toEqual({ ok: true, cfApiToken: "cf", cfZoneId: "z", railwayToken: "rw" });
});
