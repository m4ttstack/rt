function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function card(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, sans-serif; min-height: 100vh;
         margin: 0; display: grid; place-items: center; padding: 1.5rem; }
  .card { width: 100%; max-width: 340px; text-align: center; }
  h1 { font-size: 1.1rem; margin: 0 0 0.5rem; }
  p { opacity: 0.65; margin: 0.3rem 0 1rem; }
  form { display: grid; gap: 0.6rem; text-align: left; }
  input[type=password] { font: inherit; padding: 0.5rem 0.6rem; border: 1px solid #8886;
         border-radius: 7px; background: Canvas; color: CanvasText; }
  button { font: inherit; padding: 0.5rem 0.6rem; border-radius: 7px; border: 1px solid #8886;
         background: Canvas; color: CanvasText; cursor: pointer; }
  button:hover { border-color: #8888; }
  .err { color: #cf222e; font-size: 0.85rem; margin: 0; }
</style></head><body><div class="card">${body}</div></body></html>`;
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
  return card(app, `<h1>${esc(app)}</h1><p>This app is password protected.</p>
<form method="POST" action="/__auth">
  ${err}
  <input type="password" name="password" placeholder="Password" autofocus required>
  <input type="hidden" name="next" value="${next}">
  <button type="submit">Enter</button>
</form>`);
}
