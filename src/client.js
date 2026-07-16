// Progressive-enhancement client for the local-apps board.
// Polls /api/status and renders rows; restart is an in-place fetch with a
// spinner + "restarting…" status, and recent stderr lives in a hover card.
const REFRESH_MS = 5000;
const RESTART_TIMEOUT_MS = 30000;

// label -> { pid, at }: services we've asked to restart, awaiting a fresh pid.
const restarting = new Map();
let last = null;

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function dot(cls, title) {
  return `<span class="dot ${cls}" title="${esc(title)}"></span>`;
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
  else if (h.status === null) inner = `${dot("bad", "no response")} unreachable`;
  else inner = `${dot(h.ok ? "ok" : "bad", "HTTP " + h.status)} ${h.status} <span class="muted">· ${h.ms}ms</span>`;

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

function rowHtml(row, data) {
  const label = row.service && row.service.label;
  const isRestarting = label && restarting.has(label);

  const nameCell = row.url
    ? `<td><a href="${esc(row.url)}">${esc(row.name)}<span class="muted">.${esc(data.suffix)}</span></a></td>`
    : `<td class="muted">${esc(row.name)}</td>`;
  const portCell = row.port != null ? `<td class="num">${row.port}</td>` : `<td class="num muted">—</td>`;
  const healthCell = isRestarting
    ? `<td><span class="spin"></span> <span class="muted">restarting…</span></td>`
    : `<td>${healthHtml(row)}</td>`;
  const restartCell =
    data.canRestart && row.service
      ? `<td class="actions"><button class="restart" ${isRestarting ? "disabled" : ""} data-label="${esc(label)}" title="restart ${esc(row.service.short)}">↻</button></td>`
      : `<td class="actions"></td>`;

  const manageable = data.canManage && row.port != null;
  const publishCell = manageable
    ? `<td><button class="act" data-action="publish" data-app="${esc(row.name)}" data-next="${!row.published}">${row.published ? "published" : "hidden"}</button></td>`
    : `<td></td>`;
  const accessCell = manageable
    ? `<td>${
        row.hasPassword
          ? `protected <button class="act" data-action="password" data-app="${esc(row.name)}">change</button> <button class="act" data-action="clear-password" data-app="${esc(row.name)}">remove</button>`
          : `<button class="act" data-action="password" data-app="${esc(row.name)}">set password</button>`
      }</td>`
    : `<td></td>`;

  return `<tr>${nameCell}${portCell}${healthCell}<td>${serviceHtml(row)}</td>${publishCell}${accessCell}${restartCell}</tr>`;
}

function render(data) {
  if (!data) return;
  $("#sub").textContent = `${data.up}/${data.total} routes healthy · auto-refreshes`;
  $("#apps").innerHTML = data.apps.map((r) => rowHtml(r, data)).join("");

  const wrap = $("#orphans-wrap");
  if (data.orphans.length) {
    wrap.style.display = "";
    $("#orphans").innerHTML = data.orphans.map((r) => rowHtml(r, data)).join("");
  } else {
    wrap.style.display = "none";
  }

  for (const btn of document.querySelectorAll("button.restart")) {
    btn.onclick = () => onRestart(btn.dataset.label);
  }

  for (const btn of document.querySelectorAll('button.act[data-action="publish"]')) {
    btn.onclick = () => onPublish(btn.dataset.app, btn.dataset.next === "true");
  }
  for (const btn of document.querySelectorAll('button.act[data-action="password"]')) {
    btn.onclick = () => onPassword(btn.dataset.app);
  }
  for (const btn of document.querySelectorAll('button.act[data-action="clear-password"]')) {
    btn.onclick = () => onClearPassword(btn.dataset.app);
  }
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

async function refresh() {
  try {
    const data = await (await fetch("/api/status")).json();
    last = data;
    reconcile(data);
    render(data);
  } catch {
    /* transient — keep the last good render */
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
