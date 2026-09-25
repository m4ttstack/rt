import { expect, test } from "bun:test";
import { NOTIFICATION_TYPES } from "../notifier.ts";
import { recognize } from "../../packages/settings-kit/src/shapes.ts";
import { getDef } from "../../packages/rt-client/src/settings/registry-machinery.ts";
import { REGISTRY } from "../../packages/rt-client/src/settings/registry-defs.ts";

test("settings-kit's recognized rt.notifications fields mirror NOTIFICATION_TYPES", () => {
  const rtKeys = NOTIFICATION_TYPES.map((t) => t.key).sort();
  const r = recognize(getDef("rt.notifications")!.schema!);
  expect(r.kind).toBe("leaves");
  if (r.kind === "leaves") expect(Object.keys(r.fields).sort()).toEqual(rtKeys);
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
