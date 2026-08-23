// Renders each .dc.html artboard as a standalone page, once per color scheme,
// so a browser can screenshot it without the Design Components runtime.
// The artboards are static markup plus inline styles; `{{schemeClass}}` is the
// only hole, and it is what the `dark` tweak drives.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.argv[2];
const OUT = process.argv[3];
const ARTBOARDS = process.argv.slice(4);

mkdirSync(OUT, { recursive: true });

for (const file of ARTBOARDS) {
  const raw = readFileSync(join(SRC, file), 'utf8');

  const helmet = raw.match(/<helmet>([\s\S]*?)<\/helmet>/);
  if (!helmet) throw new Error(`${file}: no <helmet> block`);

  const body = raw.match(/<x-dc>([\s\S]*?)<\/x-dc>/);
  if (!body) throw new Error(`${file}: no <x-dc> block`);

  const markup = body[1].replace(/<helmet>[\s\S]*?<\/helmet>/, '').trim();
  const stem = file.replace(/\.dc\.html$/, '');

  for (const scheme of ['light', 'dark']) {
    const page = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${stem} — ${scheme}</title>
${helmet[1].trim()}
</head>
<body>
${markup.replaceAll('{{schemeClass}}', scheme === 'dark' ? 'dark' : '')}
</body>
</html>
`;
    const name = `${stem}.${scheme}.html`;
    writeFileSync(join(OUT, name), page);
    console.log(`wrote ${name}`);
  }
}
