// lib/daemon/__tests__/health-sampler.test.ts
import { test, expect } from "bun:test";
import { rollRssBaseline } from "../health-sampler.ts";

test("a reclaim dip at roll time does not lower the baseline below the window's peak", () => {
  // The live shape (RT-208): VMs launching squeezed the daemon's rss from
  // ~480MB to ~257MB right as the hourly baseline rolled, so the natural
  // re-inflation read as >50% growth. The baseline must carry the window's
  // peak, not whatever the roll-time sample happened to be.
  const hour = 60 * 60_000;
  let b = rollRssBaseline(null, { rss: 480, at: 0 }, hour);
  b = rollRssBaseline(b, { rss: 481, at: 30 * 60_000 }, hour);
  b = rollRssBaseline(b, { rss: 257, at: hour }, hour);
  expect(b.rss).toBe(481);
});

test("rss baseline rolls forward only after the window elapses", () => {
  // baseline null -> set on first sample
  let b = rollRssBaseline(null, { rss: 100, at: 0 }, 60 * 60_000);
  expect(b).toEqual({ rss: 100, at: 0, windowMax: 100 });
  // within the hour: baseline unchanged, peak tracked
  b = rollRssBaseline(b, { rss: 200, at: 30 * 60_000 }, 60 * 60_000);
  expect(b).toEqual({ rss: 100, at: 0, windowMax: 200 });
  // after the hour: rolls to the finished window's peak, new window starts now
  b = rollRssBaseline(b, { rss: 250, at: 61 * 60_000 }, 60 * 60_000);
  expect(b).toEqual({ rss: 250, at: 61 * 60_000, windowMax: 250 });
});
