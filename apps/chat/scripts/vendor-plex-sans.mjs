// Downloads IBM Plex Sans (OFL) latin woff2 at the three weights the
// transcript uses, from Google Fonts, into public/fonts. One-off; re-run
// only to change weights. The license text ships beside the fonts at
// public/fonts/OFL.txt, as the OFL requires.
import { mkdirSync, writeFileSync } from 'node:fs';

// A modern UA gets IBM Plex Sans back as one variable-font woff2 shared
// across all three @font-face weight rules (same URL for 400/500/600):
// technically correct via the font's own wght axis, but three identical
// downloaded files. This older, still-woff2-capable UA is below Google's
// variable-font cutoff, so it gets three distinct static-instance woff2s.
const UA =
  'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.102 Safari/537.36';
const css = await (
  await fetch(
    'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap',
    { headers: { 'User-Agent': UA } }
  )
).text();
mkdirSync('public/fonts', { recursive: true });

// The `/* latin */` comment PRECEDES its @font-face rule, so each chunk
// after a split starts with that rule; matching a chunk by whether it
// *contains* "font-weight: N" (rather than reading the weight out of the
// chunk's own leading rule) picks up a later weight's non-latin blocks
// instead, since those mention the same weight text further down the
// chunk. Reading font-weight and url out of each chunk's first rule keeps
// the pairing correct regardless of subset order.
const byWeight = new Map();
for (const chunk of css.split('/* latin */').slice(1)) {
  const rule = chunk.slice(0, chunk.indexOf('}') + 1);
  const weight = Number(rule.match(/font-weight:\s*(\d+);/)?.[1]);
  const url = rule.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
  if (weight && url) byWeight.set(weight, url);
}

const urls = new Set();
for (const weight of [400, 500, 600]) {
  const url = byWeight.get(weight);
  if (!url) throw new Error(`no latin woff2 for weight ${weight}`);
  if (urls.has(url))
    throw new Error(`weight ${weight} reused another weight's url: ${url}`);
  urls.add(url);
  // fetch resolves on a 4xx/5xx too; without this guard an error body would
  // be written as a valid-looking woff2 and surface only as a fallback face.
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`weight ${weight}: HTTP ${res.status} for ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeFileSync(`public/fonts/ibm-plex-sans-${weight}.woff2`, bytes);
  console.log(`ibm-plex-sans-${weight}.woff2 ${bytes.length} bytes`);
}
