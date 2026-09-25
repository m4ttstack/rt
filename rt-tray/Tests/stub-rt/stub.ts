#!/usr/bin/env bun
// Stub rt for app tests: canned contract-v1 answers per RT_STUB_SCENARIO.
// State that must change between invocations (a permission granted, a step
// retried) lives in RT_STUB_STATE_DIR so every call is a fresh process like
// the real rt.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveClaudeBin } from "../../../lib/claude-bin.ts";
import { FALLBACK_WRITING_STYLE, isPresetId, isValidSkillId } from "../../../lib/skills/writing-style.ts";
import {
  listWritingStyles, parsePluginEntries, readSkillInventory, type SkillInventory,
} from "../../../lib/skills/writing-style-sources.ts";
import { writingStyleRow as buildWritingStyleRow } from "../../../lib/setup/validators/writing-style.ts";

const scenario = process.env.RT_STUB_SCENARIO ?? "join-happy";
const stateDir = process.env.RT_STUB_STATE_DIR ?? join(import.meta.dir, ".state", scenario);
mkdirSync(stateDir, { recursive: true });
const at = new Date().toISOString();
const args = process.argv.slice(2).filter((a) => a !== "--json");

function stateGet(key: string, fallback = 0): number {
  const p = join(stateDir, key);
  return existsSync(p) ? Number(readFileSync(p, "utf8")) : fallback;
}
function stateBump(key: string): number {
  const n = stateGet(key) + 1;
  writeFileSync(join(stateDir, key), String(n));
  return n;
}
function stateSet(key: string, n: number): void { writeFileSync(join(stateDir, key), String(n)); }
function emit(obj: unknown) { process.stdout.write(JSON.stringify({ contract: 1, at, ...(obj as object) }) + "\n"); }
function fail(code: string, message: string): never { emit({ error: { code, message } }); process.exit(2); }
async function readStdinJSON(): Promise<Record<string, unknown>> {
  const text = await new Response(Bun.stdin.stream()).text();
  try { return text.trim() ? JSON.parse(text) : {}; } catch { return {}; }
}

const row = (id: string, kind: string, title: string, why: string, required: boolean, status: string,
             detail: string | null, action: unknown, recheck = "on-change", optionalNote: string | null = null) =>
  ({ id, kind, title, why, required, optionalNote, status, detail, action, recheck });

// The finish-gate scenario: the one row that gates Finish, rendered the way
// rt renders it before and after `setup waive`.
const EXTENSION_ID = "tool.fast-browser-extension";
const WAIVED_NOTE = "Skipped on this Mac: agents cannot capture screenshots or annotate evidence from your browser. Load it later from Settings.";
function extensionRow() {
  const waived = stateGet("waived") > 0;
  return {
    ...row(EXTENSION_ID, "tool", "Fast Browser extension", "Fast Browser drives your real Chrome session through this extension.", false,
           "needs-you", "not loaded in Chrome",
           { type: "steps", label: "Show steps…", steps: ["Open chrome://extensions", "Turn on Developer mode", "Load unpacked → ~/.fast-browser/extension/current/unpacked"] },
           "on-activate", waived ? WAIVED_NOTE : "You load this into Chrome yourself; Install cannot do it for you."),
    finishGated: true,
    waived,
  };
}

// The writing-style scenario: a finish-gated row that cannot be waived,
// rendered the way rt renders it before and after `skills writing-style use`.
const WRITING_STYLE_ID = "skills.writing-style";
const WRITING_STYLE_PRESETS = [
  { id: "mattstack:writing-style-sparse", label: "Sparse",
    detail: "Terse, lowercase for technical points, one tight paragraph per finding.",
    sample: "**issue:** cache is keyed on userId alone, so two tenants share an entry. key on (tenant, id)?" },
  { id: "mattstack:writing-style-conversational", label: "Conversational",
    detail: "Short, friendly sentences in sentence case, like talking to a teammate.",
    sample: "**issue:** The cache is keyed on userId alone, so two tenants can share an entry. Could we key on both?" },
  { id: "mattstack:writing-style-structured", label: "Structured",
    detail: "Labelled lines and short bullets for teams that like formal write-ups.",
    sample: "**issue:** Settings leak across tenants. Why: the cache key omits the tenant. Suggestion: key on (tenant, id)." },
];
// Not part of the choose action's own options list; carried only so the
// ready-detail label lookup below can resolve a suggestion id to a label.
const WRITING_STYLE_OPTION_ROWS = [
  { id: "team-voice", label: "team-voice", detail: "Your own style, in your home repo" },
  { id: "acme:team-writing-style", label: "acme:team-writing-style", detail: "An installed skill" },
];
const WRITING_STYLE_SUGGESTIONS = [
  "acme:review-voice", "acme:team-writing-style", "superpowers:brainstorming", "superpowers:writing-plans", "team-voice", "team:team-writing-style",
];
const CHOOSE_SUBTITLE = "The voice agents use for reviews, replies and PR descriptions posted under your name.";
const CHOOSE_FOOTNOTE = "You can also choose from a terminal: rt skills writing-style use";
const INSTALLED_STYLES = [...WRITING_STYLE_PRESETS.map((p) => p.id), ...WRITING_STYLE_SUGGESTIONS];
// RT_STUB_REAL_WRITING_STYLE=1 judges the picker against the operator's own
// skills, read through the same code the app ships with, and never writes
// there: the resolved style stays stub state, and no linkPersonalSkills or
// setSetting call ever runs against realHome.
const REAL_WRITING_STYLE = scenario === "writing-style" && process.env.RT_STUB_REAL_WRITING_STYLE === "1";

// No fallback: Bun's os.userInfo().homedir honors HOME, and the app runs the
// stub under a throwaway HOME, so a default here would silently read that
// throwaway home instead of the operator's real one.
function realHome(): string {
  const home = process.env.RT_STUB_REAL_HOME;
  if (!home || !existsSync(home) || !statSync(home).isDirectory()) {
    fail("no-real-home", "RT_STUB_REAL_HOME must be set to an existing directory in real-data mode");
  }
  return home;
}

// A failed or missing claude binary reads as "no plugins", not an error: the
// inventory still carries ~/.claude/skills and personal skills.
function realInventory(): SkillInventory {
  const home = realHome();
  const bin = process.env.RT_STUB_CLAUDE_BIN ?? resolveClaudeBin() ?? "claude";
  let plugins = null;
  try {
    const res = Bun.spawnSync([bin, "plugin", "list", "--json"], { env: { ...process.env, HOME: home } });
    if (res.exitCode === 0) plugins = parsePluginEntries(res.stdout.toString());
  } catch {
    plugins = null;
  }
  return readSkillInventory(home, plugins);
}

function realWritingStyleRow() {
  const inventory = realInventory();
  const chosen = stateGet("style") > 0;
  const idPath = join(stateDir, "style-id");
  const styleId = chosen && existsSync(idPath) ? readFileSync(idPath, "utf8") : undefined;
  const resolved = styleId ? { skill: styleId, source: "user" as const } : { skill: FALLBACK_WRITING_STYLE, source: "fallback" as const };
  // Real rt's `use` links a chosen personal skill into ~/.claude/skills before
  // returning; this mode never writes to realHome, so a stub-chosen personal
  // name is instead added to the in-memory installed set, matching what the
  // real pipeline would show without ever linking anything on disk.
  if (styleId && inventory.personal.some((p) => p.name === styleId)) inventory.installed.add(styleId);
  const options = listWritingStyles(inventory, resolved).options;
  return { ...buildWritingStyleRow({ homeReady: true, resolved, inventory, options }), waivable: false };
}

function writingStyleRow() {
  const chosen = stateGet("style") > 0;
  const idPath = join(stateDir, "style-id");
  const selected = chosen ? (existsSync(idPath) ? readFileSync(idPath, "utf8") : WRITING_STYLE_PRESETS[0]!.id) : undefined;
  const lookup = [...WRITING_STYLE_PRESETS, ...WRITING_STYLE_OPTION_ROWS];
  const label = lookup.find((o) => o.id === selected)?.label ?? selected;
  return {
    ...row(WRITING_STYLE_ID, "tool", "Writing style",
           "How the reviews, replies and PR descriptions agents post under your name read. Without one they read like an AI assistant.", false,
           chosen ? "ready" : "needs-you",
           chosen ? `${label} (yours)` : "Not chosen yet",
           { type: "choose", label: "Choose style…", verb: ["skills", "writing-style", "use"],
             subtitle: CHOOSE_SUBTITLE, footnote: CHOOSE_FOOTNOTE, options: WRITING_STYLE_PRESETS,
             ...(selected ? { selected } : {}),
             other: { label: "Use my own skill…", hint: "Any installed skill id. Start one with rt skills writing-style new.", suggestions: WRITING_STYLE_SUGGESTIONS } }),
    finishGated: true,
    waivable: false,
  };
}

function plan(): unknown {
  const fdaCalls = stateBump("plan-calls");
  const fdaGranted = scenario !== "perm-denied-then-granted" || fdaCalls >= 3;
  const mode = scenario === "create-happy" ? "create" : scenario === "restore" ? "restore" : "join";
  const mac = [
    row("perm.fda", "permission", "Full Disk Access",
        "Reads your repositories' git state so the daemon can show branch and MR status.", true,
        fdaGranted ? "ready" : "needs-you", fdaGranted ? "Granted" : "Not granted",
        fdaGranted ? null : { type: "open-settings", label: "Open Full Disk Access Settings…", target: "fda" }, "on-activate"),
    row("perm.login-items", "permission", "Background services",
        "rt daemon and deck run in the background as login items.", true, "ready", "Enabled", null, "on-activate"),
    row("perm.notifications", "permission", "Notifications", "Pipeline and review alerts.", false, "skipped", "Not decided",
        { type: "request-permission", label: "Allow", which: "notifications" }, "on-activate",
        "Works without this; you'll see menu-bar badges instead."),
    row("tool.clt", "tool", "Apple command line tools", "git and python3 come from here.", true, "ready", "git 2.50.1", null),
    row("tool.path", "info", "~/.local/bin first on PATH", "Install adds one PATH line to your shell rc.", true, "ready", "Fixed by Install", null),
  ];
  const accounts = [
    row("account.gitlab", "account", "GitLab", "The team's merge requests live on gitlab.example.com.", true,
        stateGet("gitlab-connected") ? "ready" : "missing", stateGet("gitlab-connected") ? "token can see group acme" : null,
        { type: "connect", label: "Connect", integration: "gitlab",
          fields: [{ name: "token", label: "Personal access token", secret: true, hint: "read_api, read_user, read_repository" }],
          alternatives: [],
          create: { label: "Create a token on GitLab…", url: "https://gitlab.example.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=read_api%2Cread_user%2Cread_repository" } }),
  ];
  const access = [row("access.team-repo", "access", "Team repo reachable", "github.com/acme/mattstack-team-acme", true, "ready", "ls-remote ok", null)];
  const tools = [
    row("tool.herdr", "tool", "herdr", "Runs the agents that do the work.", true, "ready", "0.9.2", null),
    row("tool.fast-browser", "tool", "Fast Browser", "Browser automation for evidence.", true, "needs-you", "extension not loaded",
        { type: "steps", label: "Show steps…", steps: ["Open chrome://extensions", "Turn on Developer mode", "Load unpacked → ~/.fast-browser/extension/current/unpacked"] }),
    row("tool.chrome", "tool", "Google Chrome", "Evidence capture.", false, "skipped", null,
        { type: "open-url", label: "Download", url: "https://www.google.com/chrome/" }, "manual", "Works without this."),
  ];
  // Scenarios other than perm-denied-then-granted are installable out of the box so
  // flows can reach Install without connecting anything; perm-denied-then-granted
  // gates only on perm.fda so the second plan() call can flip canInstall to true.
  const installableScenario = ["join-happy", "create-happy", "apply-fail-retry", "restore", "uninstall", "perm-denied-then-granted", "finish-gate", "writing-style"].includes(scenario);
  // accounts[0] and tools[1] are the fixed literal elements built above — non-null
  // is safe, not a runtime guess.
  if (installableScenario) { accounts[0]!.status = "ready"; accounts[0]!.detail = "token can see group acme"; tools[1]!.status = "ready"; tools[1]!.detail = "extension loaded"; }
  const gated: { id: string; status: string; waived?: boolean }[] =
    scenario === "finish-gate" ? [extensionRow()]
    : scenario === "writing-style" ? [REAL_WRITING_STYLE ? realWritingStyleRow() : writingStyleRow()]
    : [];
  const requiredMissing = [...mac, ...accounts, ...access, ...tools].filter((r) => r.required && r.status !== "ready").map((r) => r.id);
  const finishBlockedBy = gated.filter((r) => r.status !== "ready" && !r.waived).map((r) => r.id);
  return {
    team: { slug: "acme", name: "Acme", mode },
    groups: [
      { id: "mac", title: "Your Mac", rows: mac },
      { id: "accounts", title: "Accounts", rows: accounts },
      { id: "access", title: "Access", rows: access },
      { id: "tools", title: "Tools", rows: [...tools, ...gated] },
    ],
    canInstall: requiredMissing.length === 0,
    requiredMissing,
    finishBlockedBy,
  };
}

// scenario "restore" uses the contract's home.restore step id in place of home.init.
const STEPS = [
  scenario === "restore" ? ["home.restore", "Restore your settings home repo", "rt"] : ["home.init", "Create your settings home repo", "rt"],
  ["team.join", "Join the team", "rt"],
  ["secrets.write", "Store the tokens you entered", "rt"], ["path.link", "Link rt, fast-browser, gitq, deck into ~/.local/bin", "rt"],
  ["settings.seed", "Write machine settings", "rt"], ["repos.clone", "Clone the team's repositories", "rt"],
  ["services.register", "Register the rt daemon and deck", "app"], ["proxy.install", "Install the local HTTPS proxy", "privileged"],
  ["plugins.install", "Install the mattstack skills into Claude Code", "rt"], ["services.start", "Start services", "rt"],
  ["verify", "Verify everything", "rt"],
] as const;

// The contract's v1 uninstall action ids, in order; `data` only with
// --delete-data. The dry-run lists them and the real run streams the same set,
// so the app's confirmation sheet and its progress list can never disagree.
function uninstallActions(): { id: string; title: string; kind: "rt" | "app" | "privileged" }[] {
  return [
    { id: "deck.managed-remove", title: "Remove mattstack's apps from deck", kind: "rt" },
    { id: "services.unregister", title: "Stop and remove the rt daemon and deck services", kind: "app" },
    { id: "proxy.remove", title: "Remove the local HTTPS proxy (admin prompt)", kind: "privileged" },
    { id: "path.unlink", title: "Remove ~/.local/bin links", kind: "rt" },
    { id: "shell.remove", title: "Remove the shell rc block", kind: "rt" },
    { id: "extension.uninstall", title: "Uninstall the rt-context editor extension", kind: "rt" },
    { id: "plugins.uninstall", title: "Uninstall the mattstack plugins from Claude Code", kind: "rt" },
    ...(args.includes("--delete-data") ? [{ id: "data", title: "Delete ~/.mattstack (settings, state, logs)", kind: "rt" as const }] : []),
    { id: "app.trash", title: "Move mattstack.app to the Trash", kind: "rt" },
  ];
}

async function apply() {
  const fromIdx = Math.max(0, args.indexOf("--from"));
  const fromId = fromIdx > 0 ? args[fromIdx + 1] : null;
  const start = fromId ? STEPS.findIndex((s) => s[0] === fromId) : 0;
  const steps = STEPS.slice(start < 0 ? 0 : start);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const line = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
  line({ event: "plan", steps: steps.map(([id, title, kind]) => ({ id, title, kind })) });
  for (const [id, , kind] of steps) {
    line({ event: "step", id, state: "running" });
    await sleep(120);
    if (kind === "app") {
      line({ event: "need", id, request: { type: "app-register-services", plists: ["com.mattstack.daemon.plist", "com.mattstack.deck.plist"] } });
    } else if (kind === "privileged") {
      line({ event: "need", id, request: { type: "app-privileged", op: "proxy-install" } });
    } else {
      line({ event: "log", id, line: `${id}: working…` });
    }
    if (scenario === "apply-fail-retry" && id === "plugins.install" && stateBump("plugins-attempts") === 1) {
      line({ event: "step", id, state: "failed", detail: "claude plugin install exited 1",
             remedy: "Open Claude Code once so it finishes first-run, then Retry." });
      line({ event: "done", ok: false, failedStep: id });
      return;
    }
    line({ event: "step", id, state: "done", detail: kind === "rt" ? "ok" : "done by the app" });
  }
  line({ event: "done", ok: true, failedStep: null });
}

const [a0, a1, a2] = args;
if (a0 === "setup" && (a1 === "plan" || a1 === "status")) emit(plan());
else if (a0 === "setup" && a1 === "apply") await apply();
else if (a0 === "setup" && a1 === "github" && a2 === "status") emit({ integration: "github", status: "ready", detail: "gh authenticated as matt", scopesSeen: ["repo", "read:org"], handle: "matt", owners: ["matt", "acme"] });
else if (a0 === "setup" && a1 === "intent" && a2 === "restore") emit({ ok: true, intent: "restore", repo: args[3] });
else if (a0 === "setup" && (a1 === "waive" || a1 === "unwaive")) {
  if (a2 !== EXTENSION_ID) fail("not-finish-gated", `${a2} is not a finish-gated row; finish-gated rows: ${EXTENSION_ID}`);
  const wasWaived = stateGet("waived") > 0;
  stateSet("waived", a1 === "waive" ? 1 : 0);
  emit({ ok: true, id: a2, changed: wasWaived !== (a1 === "waive"), waived: a1 === "waive" ? [a2] : [] });
}
else if (a0 === "skills" && a1 === "writing-style" && a2 === "use") {
  const id = args[3];
  if (id === undefined) fail("usage", "usage: rt skills writing-style use <skill-id> [--scope user|team] [--json]");
  if (!isValidSkillId(id)) fail("bad-id", `"${id}" is not a skill id`);
  if (REAL_WRITING_STYLE) {
    const inventory = realInventory();
    const known = isPresetId(id) || inventory.installed.has(id) || inventory.personal.some((p) => p.name === id);
    if (!known) fail("unknown-skill", `${id} is not installed here.`);
  } else if (!INSTALLED_STYLES.includes(id)) {
    fail("unknown-skill", `${id} is not installed here. Choose one of: ${INSTALLED_STYLES.join(", ")}`);
  }
  stateSet("style", 1);
  writeFileSync(join(stateDir, "style-id"), id);
  emit({ skill: id, scope: "user" });
}
else if (a0 === "setup" && a2 === "status") emit({ integration: a1, status: stateGet(`${a1}-connected`) ? "ready" : "missing", detail: null });
else if (a0 === "setup" && a2 === "connect") {
  const body = await readStdinJSON();
  if (!body.token && !body.useGh) fail("no-token", "Paste a token or use gh.");
  stateBump(`${a1}-connected`);
  emit({ integration: a1, status: "ready", detail: "token can see group acme", scopesSeen: ["read_api"] });
}
else if (a0 === "team" && a1 === "create") emit({ slug: "my-team", name: args[2] ?? "My team", remote: "https://github.com/matt/mattstack-team-my-team.git", created: true });
else if (a0 === "team" && a1 === "join") {
  const body = await readStdinJSON();
  if (!body.code) fail("invite-malformed", "Paste an invite code.");
  if (scenario === "join-no-access") emit({ team: { slug: "acme", name: "Acme", owner: "matt" }, access: "denied", peering: "idle", intent: "written", message: "Joining Acme. Your GitHub account cannot see acme/team yet: ask matt or your org admin to grant read access." });
  else emit({ team: { slug: "acme", name: "Acme", owner: "matt" }, access: "ok", peering: "idle", intent: "written", message: "Joining Acme (owner matt)" });
}
else if (a0 === "team" && a1 === "status") emit({ slug: "acme", name: "Acme", remote: "git@github.com:acme/mattstack-team-acme.git", lastPush: "2026-08-21T03:00:00Z", members: [{ username: "matt" }, { username: "bob" }] });
else if (a0 === "team" && a1 === "invite") emit({ code: "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567", expiresAt: "2026-08-28T00:00:00Z",
  pasteBlock: "Install mattstack from https://github.com/m4ttstack/rt/releases, then open mattstack://join/ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567 or paste the code into Setup → Join a team.",
  forgeAccess: "granted", manualSteps: [], link: "https://mattstack.dev/join#ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567" });
else if (a0 === "uninstall" && args.includes("--dry-run")) emit({ actions: uninstallActions() });
else if (a0 === "uninstall") {
  if (args.includes("--delete-data") && !args.includes("--yes")) fail("confirm-required", "--delete-data needs --yes when not on a TTY.");
  const line = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
  const actions = uninstallActions();
  line({ event: "plan", steps: actions.map((a) => ({ id: a.id, title: a.title, kind: a.kind })) });
  for (const a of actions) {
    line({ event: "step", id: a.id, state: "running" });
    if (a.id === "services.unregister") {
      line({ event: "need", id: a.id, request: { type: "app-unregister-services", plists: ["com.mattstack.daemon.plist", "com.mattstack.deck.plist"] } });
    } else if (a.id === "proxy.remove") {
      line({ event: "need", id: a.id, request: { type: "app-privileged", op: "proxy-remove" } });
    }
    line({ event: "step", id: a.id, state: "done", detail: a.kind === "rt" ? "ok" : "done by the app" });
  }
  line({ event: "done", ok: true, failedStep: null }); }
else if (a0 === "settings" && a1 === "set") emit({ ok: true, key: a2 });
else if (a0 === "restore") emit({ ok: true, repo: a1 });
else if (a0 === "home" && a1 === "init") emit({ ok: true });
else if (a0 === "version" || a0 === "--version") emit({ version: "2.8.0-stub", build: 0 });
else fail("unknown-verb", `stub has no answer for: ${args.join(" ")}`);
