// Progressive-enhancement client for the local-apps board.
// Polls /api/status and renders rows; restart is an in-place fetch with a
// spinner + "restarting…" status, and recent stderr lives in a hover card.
const REFRESH_MS = 5000;
const RESTART_TIMEOUT_MS = 30000;

// label -> { pid, at }: services we've asked to restart, awaiting a fresh pid.
const restarting = new Map();
let last = null;

// The single port cell currently being edited: { app, value } or null.
let editing = null;

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function dot(cls, title) {
  return `<span class="dot ${cls}" title="${esc(title)}"></span>`;
}

// A small padlock glyph, tinted via currentColor.
function lockIcon() {
  return `<svg class="lock-i" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm3 8H9V6a3 3 0 0 1 6 0z"/></svg>`;
}

// An external-link glyph for launching the public tunnel URL.
function launchIcon() {
  return `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>`;
}

function allRows(data) {
  return data ? [...data.apps, ...data.orphans] : [];
}

function findRow(data, label) {
  return allRows(data).find((r) => r.service && r.service.label === label) || null;
}

function healthHtml(row) {
  const h = row.health;
  let inner;
  if (!h) inner = `<span class="muted">no route</span>`;
  else if (h.status === null) inner = `<span class="hpill bad" title="no response">unreachable</span>`;
  else
    inner = `<span class="hpill ${h.ok ? "ok" : "bad"}" title="HTTP ${h.status}">${h.status} <span class="muted">${h.ms}ms</span></span>`;

  const logs = row.service && row.service.stderr ? row.service.stderr : [];
  const card = logs.length
    ? `<span class="card"><span class="card-h">recent stderr</span><pre>${esc(logs.join("\n"))}</pre></span>`
    : "";
  return `<span class="status${card ? " has-card" : ""}">${inner}${card}</span>`;
}

function serviceHtml(row) {
  const s = row.service;
  if (!s) return `<span class="muted">no launchd service</span>`;
  if (s.unmanaged) {
    return `${dot("warn", "unmanaged process")} served by unmanaged <code>${esc(s.unmanaged.command)}</code> pid ${s.unmanaged.pid} <span class="muted">· service ${esc(s.short)} stopped</span>`;
  }
  const state =
    s.pid !== null
      ? `${dot("ok", "running")} pid ${s.pid}`
      : `${dot("bad", "not running")} stopped${s.lastExitStatus != null ? ` (exit ${s.lastExitStatus})` : ""}`;
  return `${state} <span class="muted">· ${esc(s.short)}</span>`;
}

function portCellHtml(row, data) {
  const app = esc(row.name);
  // The board's own row (row.self) is never port-editable -- overriding it would
  // repoint the dashboard itself. Render a plain port like orphan/read-only rows.
  if (!data.canManage || row.port == null || row.self) {
    return row.port != null ? `<td class="num">${row.port}</td>` : `<td class="num muted">—</td>`;
  }
  const ov = row.override;
  if (editing && editing.app === row.name) {
    const base = ov ? `<s class="muted">${ov.basePort}</s> &rarr; ` : "";
    return `<td class="num">${base}<input class="port-edit" data-app="${app}" value="${esc(editing.value)}" placeholder="dev port" inputmode="numeric"></td>`;
  }
  if (ov) {
    return `<td class="num"><span class="ovr" data-action="edit-port" data-app="${app}" title="click to change dev port">⚡ <s class="muted">${ov.basePort}</s> &rarr; ${row.port}</span><button class="pill danger clear-port" data-action="clear-port" data-app="${app}" title="revert to ${ov.basePort}">×</button></td>`;
  }
  return `<td class="num"><span class="port-set" data-action="edit-port" data-app="${app}" title="click to point at a dev process port">${row.port}</span></td>`;
}

function rowHtml(row, data) {
  const label = row.service && row.service.label;
  const isRestarting = label && restarting.has(label);

  // A launch icon to the public tunnel URL, when it differs from the shown link
  // (i.e. on the local .localhost board). Dimmed when the app is private.
  const launch =
    row.publicUrl && row.publicUrl !== row.url
      ? `<a class="launch${row.published ? "" : " off"}" href="${esc(row.publicUrl)}" target="_blank" rel="noopener" title="${row.published ? "open " + esc(row.publicUrl.replace(/^https:\/\//, "")) : "private — not publicly reachable"}">${launchIcon()}</a>`
      : "";
  const nameCell = row.url
    ? `<td class="site-cell"><a class="site" href="${esc(row.url)}">${esc(row.name)}<span class="muted">.${esc(data.suffix)}</span></a>${launch}</td>`
    : `<td class="site-cell muted">${esc(row.name)}</td>`;
  const portCell = portCellHtml(row, data);
  const healthCell = isRestarting
    ? `<td><span class="hpill restarting"><span class="spin"></span>restarting…</span></td>`
    : `<td>${healthHtml(row)}</td>`;
  const restartCell =
    data.canRestart && row.service
      ? `<td class="actions"><button class="restart" ${isRestarting ? "disabled" : ""} data-label="${esc(label)}" title="restart ${esc(row.service.short)}">↻</button></td>`
      : `<td class="actions"></td>`;

  const manageable = data.canManage && row.port != null;
  const app = esc(row.name);
  const publishCell = manageable
    ? `<td class="manage"><button class="toggle ${row.published ? "on" : ""}" role="switch" aria-checked="${row.published}" data-action="publish" data-app="${app}" data-next="${!row.published}" title="${row.published ? "public — click to make private" : "private — click to publish"}"><span class="toggle-track"></span><span class="toggle-knob"></span></button></td>`
    : `<td></td>`;
  const accessCell = manageable
    ? `<td class="manage">${
        row.hasPassword
          ? `<span class="access-row"><span class="lock-badge" title="password required to view">${lockIcon()} protected</span><button class="pill" data-action="password" data-app="${app}">change</button><button class="pill danger" data-action="clear-password" data-app="${app}">remove</button></span>`
          : `<button class="pill set" data-action="password" data-app="${app}">${lockIcon()} set password</button>`
      }</td>`
    : `<td></td>`;

  return `<tr>${nameCell}${portCell}${healthCell}<td class="svc-cell">${serviceHtml(row)}</td>${publishCell}${accessCell}${restartCell}</tr>`;
}

// A cloudflared tunnel row: reads as infra health (up/down), not a stray app.
function tunnelRow(row, data) {
  const s = row.service;
  const label = s && s.label;
  const isRestarting = label && restarting.has(label);
  const up = !!(s && s.pid !== null);
  const statusCell = isRestarting
    ? `<td><span class="hpill restarting"><span class="spin"></span>restarting…</span></td>`
    : `<td><span class="hpill ${up ? "ok" : "bad"}" title="${up ? "tunnel running" : "tunnel stopped"}">${up ? "up" : "down"}</span></td>`;
  const detail = up
    ? `${dot("ok", "running")} pid ${s.pid}`
    : `${dot("bad", "stopped")} stopped${s && s.lastExitStatus != null ? ` (exit ${s.lastExitStatus})` : ""}`;
  const restartCell =
    data.canRestart && s
      ? `<td class="actions"><button class="restart" ${isRestarting ? "disabled" : ""} data-label="${esc(label)}" title="restart tunnel">↻</button></td>`
      : `<td class="actions"></td>`;
  return `<tr><td><strong>Cloudflare tunnel</strong> <span class="muted">${esc(row.name)}</span></td>${statusCell}<td>${detail} <span class="muted">carries *.${esc(data.suffix === "localhost" ? "m4tthew.dev" : data.suffix)}</span></td>${restartCell}</tr>`;
}

function render(data) {
  if (!data) return;
  const publicCount = data.apps.filter((r) => r.published).length;
  const protectedCount = data.apps.filter((r) => r.hasPassword).length;
  const parts = [`${data.up}/${data.total} healthy`, `${publicCount} public`];
  if (protectedCount) parts.push(`${protectedCount} protected`);
  if (data.nextPort) parts.push(`next port ${data.nextPort}`);
  parts.push("auto-refreshes");
  $("#sub").innerHTML = parts.join(`<span class="sep">·</span>`);
  // Restarting the proxy is a local-only control, like restart/publish/access.
  $("#proxy-reload").hidden = !data.canManage;
  // A stale proxy serves old ports on .localhost while every health probe (which
  // hits ports directly) still reads green, so say so loudly.
  if (data.canManage && Date.now() > proxyMsgHoldUntil) proxyBanner(data);
  $("#apps").innerHTML = data.apps.map((r) => rowHtml(r, data)).join("");

  // Split the routeless services: cloudflared tunnels are infra (their own
  // section, shown as up/down health), everything else is a true stray.
  const tunnels = data.orphans.filter((r) => r.isTunnel);
  const strays = data.orphans.filter((r) => !r.isTunnel);

  const tunnelWrap = $("#tunnels-wrap");
  if (tunnels.length) {
    tunnelWrap.style.display = "";
    $("#tunnels").innerHTML = tunnels.map((r) => tunnelRow(r, data)).join("");
  } else {
    tunnelWrap.style.display = "none";
  }

  const wrap = $("#orphans-wrap");
  if (strays.length) {
    wrap.style.display = "";
    $("#orphans").innerHTML = strays.map((r) => rowHtml(r, data)).join("");
  } else {
    wrap.style.display = "none";
  }

  for (const btn of document.querySelectorAll("button.restart")) {
    btn.onclick = () => onRestart(btn.dataset.label);
  }

  for (const btn of document.querySelectorAll('button[data-action="publish"]')) {
    btn.onclick = () => onPublish(btn.dataset.app, btn.dataset.next === "true");
  }
  for (const btn of document.querySelectorAll('button[data-action="password"]')) {
    btn.onclick = () => onPassword(btn.dataset.app);
  }
  for (const btn of document.querySelectorAll('button[data-action="clear-password"]')) {
    btn.onclick = () => onClearPassword(btn.dataset.app);
  }

  for (const el of document.querySelectorAll('[data-action="edit-port"]')) {
    el.onclick = () => {
      editing = { app: el.dataset.app, value: "" };
      render(last);
    };
  }
  for (const el of document.querySelectorAll('[data-action="clear-port"]')) {
    el.onclick = () => submitPort(el.dataset.app, "");
  }
  const input = document.querySelector("input.port-edit");
  if (input) {
    input.oninput = () => {
      if (editing) editing.value = input.value;
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        const v = input.value.trim();
        if (v === "") {
          editing = null;
          render(last);
          return;
        }
        submitPort(input.dataset.app, v);
      } else if (e.key === "Escape") {
        editing = null;
        render(last);
      }
    };
    input.onblur = () => {
      if (!editing || editing.app !== input.dataset.app) return;
      editing = null;
      render(last);
    };
    input.focus();
    const n = input.value.length;
    input.setSelectionRange(n, n);
  }
}

function submitPort(app, value) {
  editing = null;
  const body = new URLSearchParams({ app, port: value }); // "" clears the override
  fetch("/devport", { method: "POST", body })
    .catch(() => {})
    .then(refresh);
}

function onRestart(label) {
  const row = findRow(last, label);
  restarting.set(label, { pid: row && row.service ? row.service.pid : null, at: Date.now() });
  render(last); // instant spinner, don't wait for the poll
  fetch("/restart", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "label=" + encodeURIComponent(label),
  }).catch(() => {});
}

async function onPublish(name, next) {
  const body = new URLSearchParams({ app: name, published: String(next) });
  try {
    await fetch("/publish", { method: "POST", body });
  } catch {
    /* transient — the next refresh will show the true state */
  }
  await refresh();
}

function onPassword(name) {
  const pw = prompt(`Password for ${name} (blank to cancel):`);
  if (pw === null || pw === "") return;
  const body = new URLSearchParams({ app: name, password: pw });
  fetch("/password", { method: "POST", body })
    .catch(() => {})
    .then(refresh);
}

function onClearPassword(name) {
  const body = new URLSearchParams({ app: name, password: "" });
  fetch("/password", { method: "POST", body })
    .catch(() => {})
    .then(refresh);
}

// Clear the restarting flag once the service has a NEW pid and is healthy again
// (or if we've waited too long — a stuck restart shouldn't spin forever).
function reconcile(data) {
  for (const [label, st] of [...restarting]) {
    const row = findRow(data, label);
    const pid = row && row.service ? row.service.pid : null;
    const healthy = row ? (row.health ? row.health.ok : pid !== null) : false;
    const restarted = pid !== null && pid !== st.pid && healthy;
    if (restarted || Date.now() - st.at > RESTART_TIMEOUT_MS) restarting.delete(label);
  }
}

// --- portless proxy reload ---
// portless's routes.json watcher dies on long-lived proxies, so route changes
// (an override, a renumbered app) stop reaching it and .localhost serves stale
// ports. Restarting the daemon is the fix; it needs root, so the server may
// answer with a one-time sudoers install command instead.
// A message from an explicit click outranks the automatic stale banner, but only
// briefly: if the proxy is still stale after that, the banner must come back.
let proxyMsgHoldUntil = 0;

function proxyMsg(cls, html, holdMs = 0) {
  const el = $("#proxy-msg");
  el.className = cls;
  el.innerHTML = html;
  el.hidden = false;
  if (holdMs) proxyMsgHoldUntil = Date.now() + holdMs;
}

// Report the proxy's route sync: an auto-restart in progress, one that just
// happened, or a stale proxy nothing is fixing (auto-heal off, unauthorized, or
// given up after restarts failed to help).
const HEAL_RECENT_MS = 120000;

function proxyBanner(data) {
  const heal = data.autoHeal;
  const recent = heal && Date.now() - heal.at < HEAL_RECENT_MS;
  const at = heal ? new Date(heal.at).toLocaleTimeString() : "";

  if (recent && heal.ok === null) {
    proxyMsg(
      "bad",
      `<strong>.localhost routes were stale.</strong> Restarting the proxy automatically (${esc(at)})…`,
    );
  } else if (data.proxyStale) {
    proxyMsg(
      "bad",
      "<strong>.localhost routes are stale.</strong> The proxy stopped following " +
        "routes.json, so overrides and renumbered apps are not reaching it. " +
        "Click <em>reload proxy</em> to resync.",
    );
  } else if (recent && heal.ok) {
    proxyMsg("ok", `Routes were stale; the proxy was restarted automatically at ${esc(at)}.`);
  }
}

// Poll until the board answers again. Served through the proxy, that only
// happens once the proxy is back; served on localhost directly, it never drops.
async function waitForProxy(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let sawDrop = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch("/healthz", { cache: "no-store" });
      // Reaching a healthy board after it went away means the proxy is back.
      if (res.ok && sawDrop) return true;
      if (!res.ok) sawDrop = true;
    } catch {
      sawDrop = true; // connection refused while the proxy is down
    }
    // Direct (non-proxied) access never drops, so stop waiting once the
    // restart has had time to complete.
    if (!sawDrop && Date.now() > deadline - timeoutMs + 15000) return true;
  }
  return false;
}

async function onProxyReload() {
  const btn = $("#proxy-reload");
  btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span>restarting…`;
  $("#proxy-msg").hidden = true;
  try {
    const res = await fetch("/proxy-restart", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (body.ok) {
      // The proxy is going down and, if this page is served through it, so is
      // our connection. Wait for it to answer again rather than assume.
      const back = await waitForProxy();
      proxyMsg(
        back ? "ok" : "bad",
        back
          ? "portless proxy restarted — .localhost now serves the current routes."
          : "the proxy did not come back within 45s. Check: launchctl print system/sh.portless.proxy",
        30000,
      );
    } else if (body.error === "not-authorized") {
      proxyMsg(
        "bad",
        "One-time setup: the board isn't allowed to restart the proxy yet. " +
          "Run this in a terminal (it validates the rule before activating it), then try again:" +
          `<pre>${esc(body.installCommand || "")}</pre>`,
        60000,
      );
    } else {
      proxyMsg("bad", `restart failed: ${esc(body.detail || res.status)}`, 30000);
    }
  } catch (err) {
    proxyMsg("bad", `restart failed: ${esc(String(err))}`);
  }
  btn.disabled = false;
  btn.textContent = "reload proxy";
  await refresh();
}

async function refresh() {
  if (editing) return; // don't destroy the live input mid-edit; resumes once submit/cancel clears it
  try {
    const data = await (await fetch("/api/status")).json();
    last = data;
    reconcile(data);
    render(data);
  } catch {
    /* transient — keep the last good render */
  }
}

$("#proxy-reload").onclick = onProxyReload;

refresh();
setInterval(refresh, REFRESH_MS);
