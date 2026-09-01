import { describe, expect, test } from "bun:test";
import { PNG } from "pngjs";
import { BAND_H, BAND_W, latchBannerPng } from "../latch/banner.ts";

const MR_A = "https://gitlab.com/acme/web/-/merge_requests/2317";
const MR_B = "https://gitlab.com/acme/web/-/merge_requests/2318";

function decode(buf: Buffer): PNG {
  return PNG.sync.read(buf);
}

describe("latchBannerPng", () => {
  test("returns a PNG at the band's dimensions", () => {
    const png = decode(latchBannerPng(MR_A));
    expect(png.width).toBe(BAND_W);
    expect(png.height).toBe(BAND_H);
  });

  // The sprite is the per-MR part, so two MRs must not produce identical bytes.
  test("differs between MRs", () => {
    expect(latchBannerPng(MR_A).equals(latchBannerPng(MR_B))).toBe(false);
  });

  // invadrs freezes its hash, so the same MR must render the same banner forever.
  test("is deterministic for one MR", () => {
    expect(latchBannerPng(MR_A).equals(latchBannerPng(MR_A))).toBe(true);
  });

  test("paints the sprite in the board pink, not a palette colour", () => {
    const png = decode(latchBannerPng(MR_A));
    // Count ONLY inside the sprite box. The band's own pink rule spans the full
    // width, so a whole-image count would pass even with sprite painting broken.
    let pink = 0;
    for (let y = 44; y < 44 + 120; y++) {
      for (let x = 120; x < 120 + 120; x++) {
        const i = (png.width * y + x) << 2;
        if (png.data[i] === 0xff && png.data[i + 1] === 0x6b && png.data[i + 2] === 0x9d) pink++;
      }
    }
    expect(pink).toBeGreaterThan(1000);
  });
});
