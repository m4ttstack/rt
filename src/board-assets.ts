import { readFileSync } from "fs";
import { join } from "path";

// The board shell and client are read once at startup, exactly like the old
// inline SHELL: the server restarts on deploy, so there is no reload-on-change
// machinery to maintain.
const BOARD_HTML = readFileSync(join(import.meta.dir, "board.html"), "utf8");
const BOARD_JS = readFileSync(join(import.meta.dir, "board.js"), "utf8");

// Exact-name allowlist: /vendor/<name> resolves through this map only, so a
// crafted path can never reach outside src/vendor.
const VENDOR: Record<string, string> = {
  "halfmoon.min.css": "text/css; charset=utf-8",
  "halfmoon.modern.css": "text/css; charset=utf-8",
  "alpine.min.js": "text/javascript; charset=utf-8",
};

// no-cache means revalidate every request, not "don't cache": right for files
// that change only on deploy or a by-hand vendor bump.
const CACHE = "no-cache";

export function boardHtml(): Response {
  return new Response(BOARD_HTML, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": CACHE },
  });
}

export function boardJs(): Response {
  return new Response(BOARD_JS, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": CACHE },
  });
}

export function vendorAsset(name: string): Response | null {
  const type = VENDOR[name];
  if (!type) return null;
  return new Response(Bun.file(join(import.meta.dir, "vendor", name)), {
    headers: { "content-type": type, "cache-control": CACHE },
  });
}
