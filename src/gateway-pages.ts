function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function card(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --accent: #2da44e; --accent-hover: #2c974b; --accent-active: #24913f; }
  * { box-sizing: border-box; }
  body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh;
         margin: 0; display: grid; place-items: center; padding: 1.5rem; color: CanvasText; }
  .card { width: 100%; max-width: 360px; text-align: center;
         border: 1px solid color-mix(in srgb, CanvasText 12%, transparent); border-radius: 16px;
         padding: 2rem 1.75rem; box-shadow: 0 4px 24px color-mix(in srgb, CanvasText 9%, transparent); }
  .badge { width: 46px; height: 46px; margin: 0 auto 1.1rem; border-radius: 50%; display: grid;
         place-items: center; color: var(--accent);
         background: color-mix(in srgb, var(--accent) 15%, transparent); }
  h1 { font-size: 1.15rem; font-weight: 650; letter-spacing: -0.01em; margin: 0 0 0.4rem; }
  p { opacity: 0.6; font-size: 0.9rem; margin: 0.3rem 0 1.25rem; }
  form { display: grid; gap: 0.55rem; text-align: left; }
  label { font-size: 0.78rem; font-weight: 500; opacity: 0.72; }
  input[type=password] { font: inherit; width: 100%; padding: 0.6rem 0.7rem; border-radius: 9px;
         border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
         background: Canvas; color: CanvasText; transition: border-color .12s, box-shadow .12s; }
  input[type=password]::placeholder { opacity: 0.5; }
  input[type=password]:focus { outline: none; border-color: var(--accent);
         box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); }
  button.primary { font: inherit; font-weight: 600; width: 100%; margin-top: 0.35rem;
         padding: 0.62rem 0.7rem; border-radius: 9px; border: 1px solid transparent;
         background: var(--accent); color: #fff; cursor: pointer;
         transition: background .12s, transform .04s, box-shadow .12s; }
  button.primary:hover { background: var(--accent-hover); }
  button.primary:active { background: var(--accent-active); transform: translateY(1px); }
  button.primary:focus-visible { outline: none;
         box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 38%, transparent); }
  .err { color: #cf222e; font-size: 0.82rem; margin: 0 0 0.1rem; }
  @media (prefers-color-scheme: dark) { .badge { color: #3fb950; } .err { color: #ff7b72; } }
</style></head><body><div class="card">${body}</div></body></html>`;
}

function lockBadge(): string {
  return `<div class="badge"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm3 8H9V6a3 3 0 0 1 6 0z"/></svg></div>`;
}

export function pageNothingHere(): string {
  return card("Nothing here", `<h1>Nothing here</h1><p>There is no app at this address.</p>`);
}

export function pageOffline(app: string): string {
  return card("App is offline", `<h1>${esc(app)} is offline</h1><p>This app is not responding right now. Try again shortly.</p>`);
}

export function pageRateLimited(): string {
  return card("Too many attempts", `<h1>Too many attempts</h1><p>Please wait a minute and try again.</p>`);
}

export function pageLogin(app: string, opts: { error?: boolean; next?: string } = {}): string {
  const err = opts.error ? `<p class="err">That password didn't work.</p>` : "";
  const next = esc(opts.next ?? "/");
  return card(app, `${lockBadge()}<h1>${esc(app)}</h1><p>Enter the password to view this app.</p>
<form method="POST" action="/__auth">
  ${err}
  <label for="pw">Password</label>
  <input id="pw" type="password" name="password" placeholder="Enter password" autocomplete="current-password" autofocus required>
  <input type="hidden" name="next" value="${next}">
  <button class="primary" type="submit">Unlock</button>
</form>`);
}
