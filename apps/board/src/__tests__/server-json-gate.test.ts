import { expect, test } from 'bun:test';

const source = await Bun.file(new URL('../server.ts', import.meta.url)).text();

/** Every POST endpoint that parses a JSON body must carry the CSRF gate
    (requireJsonBody) BEFORE the parse: isLocalRequest only reads the Host
    header, which a cross-origin simple request can forge, so the exact json
    media type is what actually forces a preflight. Source-level like the
    repo-purity gates because the Bun.serve switch has no unit seam. */
test('every JSON-parsing POST case gates on requireJsonBody', () => {
  const cases = [...source.matchAll(/case '(\/[^']*)': \{/g)];
  const ungated: string[] = [];
  for (let i = 0; i < cases.length; i++) {
    const name = cases[i]![1]!;
    const start = cases[i]!.index!;
    const end = i + 1 < cases.length ? cases[i + 1]!.index! : source.length;
    const block = source.slice(start, end);
    if (!block.includes("req.method !== 'POST'")) continue;
    const parseAt = block.indexOf('req.json()');
    if (parseAt === -1) continue;
    const gateAt = block.indexOf('requireJsonBody(req)');
    if (gateAt === -1 || gateAt > parseAt) ungated.push(name);
  }
  expect(ungated).toEqual([]);
});
