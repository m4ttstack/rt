/**
 * The per-MR latch banner: the committed band artwork with this MR's invadrs
 * creature painted into the reserved box on its left.
 *
 * The sprite colour is forced rather than taken from the palette. A palette
 * pick like ocean's #1d3557 would be invisible on the near-black band; the
 * per-MR character comes from the creature's shape, and pink holds 6.84:1.
 */
import { readFileSync } from 'fs';
import { resolveSpawn } from 'invadrs';
import { PNG } from 'pngjs';

import bandAsset from '../../assets/latch-band.png' with { type: 'file' };

export const BAND_W = 1200;
export const BAND_H = 208;

const SPRITE_PINK = { r: 0xff, g: 0x6b, b: 0x9d };
/** Top-left of the sprite box inside the band, and its side, in band pixels.
    Centred in the 240px gutter that scripts/build-latch-band.ts reserves as
    the band's left padding, so the leading margin matches the band's own 60px
    trailing padding. */
const SPRITE_X = 60;
const SPRITE_Y = 44;
const SPRITE_SIDE = 120;

// The `with { type: "file" }` import resolves to a real path in both a
// checkout and a compiled binary: Bun embeds the file and extracts it to a
// temp path at runtime, so readFileSync works unchanged either way.
const DEFAULT_BAND = bandAsset;

export function latchBannerPng(
  mrUrl: string,
  bandPath: string = DEFAULT_BAND
): Buffer {
  const band = PNG.sync.read(readFileSync(bandPath));
  const { grid, padding } = resolveSpawn(mrUrl);

  // resolveSpawn's viewBox spans grid + padding on every side, so a cell at
  // index i sits at unit (i + padding) and one unit is side / (n + 2 * padding).
  const units = grid.length + padding * 2;
  const cell = SPRITE_SIDE / units;

  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row]!.length; col++) {
      if (!grid[row]![col]) continue;
      const x0 = Math.round(SPRITE_X + (col + padding) * cell);
      const y0 = Math.round(SPRITE_Y + (row + padding) * cell);
      const x1 = Math.round(SPRITE_X + (col + padding + 1) * cell);
      const y1 = Math.round(SPRITE_Y + (row + padding + 1) * cell);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (band.width * y + x) << 2;
          band.data[i] = SPRITE_PINK.r;
          band.data[i + 1] = SPRITE_PINK.g;
          band.data[i + 2] = SPRITE_PINK.b;
          band.data[i + 3] = 0xff;
        }
      }
    }
  }
  return PNG.sync.write(band);
}
