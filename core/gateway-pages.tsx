import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// readFileSync(import.meta.dir…) dies under --compile; a static import embeds
// the tokens in the binary and behaves identically under plain `bun run`.
// @ts-expect-error — tsc has no ambient module declaration for a .css text import (with {type:"text"}); runtime is correct, see core/generated-fresh.test.ts
import GATEWAY_CSS from "./generated/gateway.css" with { type: "text" };

// Static layout only: colours are the generated token vars above, so this
// block never redeclares one and needs no dark-mode branch of its own.
const LAYOUT_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh;
       margin: 0; display: grid; place-items: center; padding: 1.5rem; color: var(--fg); background: var(--bg); }
.card { width: 100%; max-width: 360px; text-align: center; border: 1px solid var(--border);
       border-radius: 16px; background: var(--panel); padding: 2rem 1.75rem;
       box-shadow: 0 4px 24px color-mix(in srgb, var(--fg) 9%, transparent); }
.badge { width: 46px; height: 46px; margin: 0 auto 1.1rem; border-radius: 50%; display: grid;
       place-items: center; color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); }
h1 { font-size: 1.15rem; font-weight: 650; letter-spacing: -0.01em; margin: 0 0 0.4rem; }
p { opacity: 0.6; font-size: 0.9rem; margin: 0.3rem 0 1.25rem; }
form { display: grid; gap: 0.55rem; text-align: left; }
label { font-size: 0.78rem; font-weight: 500; opacity: 0.72; }
input[type=password] { font: inherit; width: 100%; padding: 0.6rem 0.7rem; border-radius: 9px;
       border: 1px solid var(--border); background: var(--bg); color: var(--fg);
       transition: border-color .12s, box-shadow .12s; }
input[type=password]::placeholder { opacity: 0.5; }
input[type=password]:focus { outline: none; border-color: var(--accent);
       box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); }
button.primary { font: inherit; font-weight: 600; width: 100%; margin-top: 0.35rem;
       padding: 0.62rem 0.7rem; border-radius: 9px; border: 1px solid transparent;
       background: var(--accent); color: #fff; cursor: pointer;
       transition: filter .12s, transform .04s, box-shadow .12s; }
button.primary:hover { filter: brightness(0.92); }
button.primary:active { filter: brightness(0.85); transform: translateY(1px); }
button.primary:focus-visible { outline: none;
       box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 38%, transparent); }
.err { color: var(--red); font-size: 0.82rem; margin: 0 0 0.1rem; }
`;

function LockBadge() {
  return (
    <div className="badge">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm3 8H9V6a3 3 0 0 1 6 0z" />
      </svg>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style>{`${GATEWAY_CSS as unknown as string}${LAYOUT_CSS}`}</style>
      </head>
      <body>
        <div className="card">{children}</div>
      </body>
    </html>
  );
}

function shell(node: ReactNode): string {
  return "<!doctype html>" + renderToStaticMarkup(node);
}

export function pageNothingHere(): string {
  return shell(
    <Card title="Nothing here">
      <h1>Nothing here</h1>
      <p>There is no app at this address.</p>
    </Card>,
  );
}

export function pageOffline(app: string): string {
  return shell(
    <Card title="App is offline">
      <h1>{app} is offline</h1>
      <p>This app is not responding right now. Try again shortly.</p>
    </Card>,
  );
}

export function pageRateLimited(): string {
  return shell(
    <Card title="Too many attempts">
      <h1>Too many attempts</h1>
      <p>Please wait a minute and try again.</p>
    </Card>,
  );
}

export function pageLogin(app: string, opts: { error?: boolean; next?: string } = {}): string {
  return shell(
    <Card title={app}>
      <LockBadge />
      <h1>{app}</h1>
      <p>Enter the password to view this app.</p>
      <form method="POST" action="/__auth">
        {opts.error && <p className="err">That password didn't work.</p>}
        <label htmlFor="pw">Password</label>
        <input
          id="pw"
          type="password"
          name="password"
          placeholder="Enter password"
          autoComplete="current-password"
          autoFocus
          required
        />
        <input type="hidden" name="next" defaultValue={opts.next ?? "/"} />
        <button className="primary" type="submit">Unlock</button>
      </form>
    </Card>,
  );
}
