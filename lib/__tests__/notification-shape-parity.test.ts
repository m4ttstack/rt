import { expect, test } from "bun:test";
import { NOTIFICATION_TYPES } from "../notifier.ts";
import { NOTIFICATION_EVENTS, SHAPES } from "../../packages/settings-kit/src/shapes.ts";
import { REGISTRY } from "../../packages/rt-client/src/settings/registry-defs.ts";

test("settings-kit's rt.notifications fields mirror NOTIFICATION_TYPES", () => {
  const rtKeys = NOTIFICATION_TYPES.map((t) => t.key).sort();
  expect([...NOTIFICATION_EVENTS].sort()).toEqual(rtKeys);
  const shape = SHAPES["rt.notifications"];
  expect(shape?.kind).toBe("leaves");
  expect(Object.keys(shape!.kind === "leaves" ? shape!.fields : {}).sort()).toEqual(rtKeys);
});

// An unset preference sends (loadNotificationPrefs defaults every type to true), so the
// registry default must say so too, or every store that renders the effective value
// (the console's toggles) shows an unset notification as off.
test("the rt.notifications registry default enables every NOTIFICATION_TYPES key", () => {
  const rtKeys = NOTIFICATION_TYPES.map((t) => t.key).sort();
  const def = REGISTRY.find((d) => d.key === "rt.notifications");
  expect(def?.default).toBeDefined();
  const defaults = def!.default as Record<string, boolean>;
  expect(Object.keys(defaults).sort()).toEqual(rtKeys);
  expect(Object.values(defaults).every((v) => v === true)).toBe(true);
});
