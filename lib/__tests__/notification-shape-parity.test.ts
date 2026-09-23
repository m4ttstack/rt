import { expect, test } from "bun:test";
import { NOTIFICATION_TYPES } from "../notifier.ts";
import { NOTIFICATION_EVENTS, SHAPES } from "../../packages/settings-kit/src/shapes.ts";

test("settings-kit's rt.notifications fields mirror NOTIFICATION_TYPES", () => {
  const rtKeys = NOTIFICATION_TYPES.map((t) => t.key).sort();
  expect([...NOTIFICATION_EVENTS].sort()).toEqual(rtKeys);
  const shape = SHAPES["rt.notifications"];
  expect(shape?.kind).toBe("leaves");
  expect(Object.keys(shape!.kind === "leaves" ? shape!.fields : {}).sort()).toEqual(rtKeys);
});
