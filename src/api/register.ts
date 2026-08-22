import { mkdirSync } from "fs";
import { join } from "path";
import { readRoutes, readServices, bareName } from "../../core/discover.ts";
import { getPlatformSettings } from "./platform-settings.ts";
import {
  getRecord, putRecord, deleteRecord, listRecords, addIssue, clearIssues, reloadRegistry,
  type AppRecord, type SyncIssue,
} from "../registry/records.ts";
import { renameAppSettings, getOverride, clearOverride } from "../../core/settings.ts";
import { renameOAuth } from "../edge/oauth.ts";
import { allocatePort } from "../registry/allocate.ts";
import { authorizeStructural } from "../registry/lifecycle.ts";
import {
  LABEL_PREFIX, isPlatformManagedBy, type ServiceManager, type ServiceSpec,
} from "../services/manager.ts";
import { composeServicePath, resolveProgram } from "../services/exec-env.ts";
import type { EdgeProxy } from "../edge/portless.ts";
import { logsDir } from "./state.ts";

export interface Drivers {
  manager: ServiceManager;
  edge: EdgeProxy;
}

export interface RegisterInput {
  name: string;
  managedBy?: string;
  command?: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
  /** For services someone runs themselves: route only, no launchd supervision. */
  staticPort?: number;
  /** Record-only creation: no driver calls. Used by bootstrap catch-up and migrate. */
  adopt?: boolean;
}

export type FlowResult = { status: number; body: unknown };

const NAME_RE = /^[a-z0-9][a-z0-9.-]*$/;

/**
 * launchd does not search PATH for `ProgramArguments[0]`, so argv0 must be
 * absolute in the plist. The registry deliberately keeps the logical command
 * (`node server.js`) and this resolves it on every render, so an interpreter
 * that moves — a version manager reorganizing, or being swapped for another —
 * is picked up by the next render instead of being frozen at registration.
 *
 * Throws rather than naming a program that does not exist: launchd declines
 * to start such a job without logging anything, so writing it anyway produces
 * an app that is silently, inexplicably down.
 */
function specFor(record: AppRecord): ServiceSpec {
  const env = { ...(record.env ?? {}), PORT: String(record.port) };
  const path = env.PATH ?? composeServicePath();
  const [argv0, ...rest] = record.command!;
  const program = resolveProgram(argv0!, path);
  if (!program) throw new Error(`${argv0} not found on the service PATH (${path})`);
  return {
    label: record.label!,
    programArguments: [program, ...rest],
    workingDirectory: record.workingDirectory!,
    environment: { ...env, PATH: path },
    stdoutPath: join(logsDir(), `${record.name}.out.log`),
    stderrPath: join(logsDir(), `${record.name}.err.log`),
  };
}

/**
 * Loud degradation: run a driver call, convert failure into a recorded issue.
 * A success clears that source's issue again — a badge for a sync failure that
 * a later sync fixed is a lie, and it would otherwise be permanent.
 */
async function tryDriver(
  name: string,
  source: "portless" | "launchd",
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
    clearIssues(name, source);
  } catch (err) {
    addIssue(name, { source, message: String(err).slice(0, 300), at: new Date().toISOString() });
  }
}

/**
 * Same as tryDriver, but for teardown-phase calls where the record that
 * should receive the issue may not exist under its current cache key by the
 * time we'd call addIssue (rename deletes the old key; a same-name edit is
 * about to overwrite it via putRecord). Callers merge the returned issue onto
 * whatever record object actually gets persisted, instead of losing it.
 */
async function runDriver(
  source: "portless" | "launchd",
  fn: () => Promise<void>,
): Promise<SyncIssue | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return { source, message: String(err).slice(0, 300), at: new Date().toISOString() };
  }
}

export async function registerApp(input: RegisterInput, drivers: Drivers): Promise<FlowResult> {
  const name = input.name?.trim() ?? "";
  if (!NAME_RE.test(name)) return { status: 400, body: { error: "bad name" } };
  const isService = input.staticPort === undefined;
  if (isService && (!input.command?.length || !input.workingDirectory)) {
    return { status: 400, body: { error: "command + workingDirectory, or staticPort, required" } };
  }
  const routes = readRoutes();
  // Adoption means the route/service ALREADY exists out there (bootstrap wrote
  // its own alias moments earlier; migrate adopts years-old ones), so in adopt
  // mode only a registry-record collision counts as taken. A fresh registration
  // checks both. Without this split, bootstrapSelf's record catch-up sees the
  // alias the REAL portless driver just wrote and 409s against itself.
  const taken =
    getRecord(name) ||
    (!input.adopt && routes.some((r) => bareName(r.hostname, getPlatformSettings().tlds) === name));
  if (taken) return { status: 409, body: { error: "name taken", name } };

  let port = input.staticPort;
  if (port === undefined) {
    const allocated = allocatePort(listRecords(), routes, await readServices());
    if (allocated === null) return { status: 507, body: { error: "port range exhausted" } };
    port = allocated;
  }

  const record: AppRecord = {
    name,
    managedBy: input.managedBy ?? "user",
    port,
    kind: isService ? "service" : "external",
    ...(isService && {
      command: input.command,
      workingDirectory: input.workingDirectory,
      env: input.env,
      label: `${LABEL_PREFIX}${name}`,
    }),
    createdAt: new Date().toISOString(),
  };
  putRecord(record);

  if (!input.adopt) {
    mkdirSync(logsDir(), { recursive: true });
    if (isService) await tryDriver(name, "launchd", () => drivers.manager.install(specFor(record)));
    await tryDriver(name, "portless", () => drivers.edge.alias(name, record.port));
  }
  return { status: 201, body: { record: getRecord(name) } };
}

/** True when `app` exists on the board only as a portless route (a
    hand-registered alias, or the remnant of a removed app) with no registry
    record behind it. Publish and delete both accept these names: a row the
    board renders must be actionable, record or not. */
export function knownRouteApp(app: string): boolean {
  const tlds = getPlatformSettings().tlds;
  return readRoutes().some((r) => bareName(r.hostname, tlds) === app);
}

export async function unregisterApp(
  name: string,
  caller: string,
  force: boolean,
  drivers: Drivers,
): Promise<FlowResult> {
  const record = getRecord(name);
  if (!record) {
    if (!knownRouteApp(name)) return { status: 404, body: { error: "unknown app" } };
    // Route-only teardown: no registry record, no launchd service -- the
    // route IS the row, so removing the alias is the whole job. No
    // structural authorization either, matching the publish endpoint's
    // treatment of route-only names.
    const issue = await runDriver("portless", () => drivers.edge.removeAlias(name));
    if (issue) return { status: 200, body: { ok: false, error: issue.message } };
    return { status: 200, body: { ok: true } };
  }
  const verdict = authorizeStructural(record, caller, force);
  if (!verdict.ok) return { status: verdict.status, body: verdict.body };

  const issues: SyncIssue[] = [];
  if (record.kind === "service" && record.label) {
    const issue = await runDriver("launchd", () => drivers.manager.uninstall(record.label!));
    if (issue) issues.push(issue);
  }
  const portlessIssue = await runDriver("portless", () => drivers.edge.removeAlias(name));
  if (portlessIssue) issues.push(portlessIssue);

  if (issues.length > 0) {
    // Teardown didn't fully complete: keep the record (and the driver it
    // still owns, e.g. a launchd service that failed to uninstall) visible
    // on the board rather than silently deleting the evidence of failure.
    for (const issue of issues) addIssue(name, issue);
    return { status: 200, body: { ok: false, record: getRecord(name) } };
  }
  deleteRecord(name);
  return { status: 200, body: { ok: true } };
}

export async function editApp(
  name: string,
  patch: { name?: string; command?: string[]; workingDirectory?: string; env?: Record<string, string>; port?: number },
  caller: string,
  force: boolean,
  drivers: Drivers,
): Promise<FlowResult> {
  const record = getRecord(name);
  if (!record) return { status: 404, body: { error: "unknown app" } };
  const verdict = authorizeStructural(record, caller, force);
  if (!verdict.ok) return { status: verdict.status, body: verdict.body };
  if (patch.name !== undefined && !NAME_RE.test(patch.name)) {
    return { status: 400, body: { error: "bad name" } };
  }
  if (patch.name && patch.name !== name && getRecord(patch.name)) {
    return { status: 409, body: { error: "name taken", name: patch.name } };
  }
  if (patch.port !== undefined && (!Number.isInteger(patch.port) || patch.port < 1 || patch.port > 65535)) {
    return { status: 400, body: { error: "bad port" } };
  }

  // Tear down the old shape, write the new record, stand the new shape up.
  const oldLabel = record.label;
  const oldName = record.name;
  const next: AppRecord = {
    ...record,
    name: patch.name ?? record.name,
    command: patch.command ?? record.command,
    workingDirectory: patch.workingDirectory ?? record.workingDirectory,
    env: patch.env ?? record.env,
    port: patch.port ?? record.port,
  };
  if (next.kind === "service") next.label = `${LABEL_PREFIX}${next.name}`;
  // A dev-port override lives entirely in settings, keyed off the app's base
  // port at the time it was set. If this edit actually changes the base port,
  // that captured basePort is now stale... a later "clear override" would
  // revert to the wrong port, so the edit drops the override rather than
  // leave it silently wrong.
  const portChanged = next.port !== record.port;

  // Teardown-phase failures are collected, not recorded yet: the record they
  // belong to doesn't exist under its final cache key yet (a rename deletes the
  // old entry outright, a same-name edit is about to overwrite it via putRecord
  // below), so an addIssue() written here against the old key would be lost.
  const teardownIssues: SyncIssue[] = [];
  if (next.kind === "service" && oldLabel) {
    const issue = await runDriver("launchd", () => drivers.manager.uninstall(oldLabel));
    if (issue) teardownIssues.push(issue);
  }
  const renaming = next.name !== oldName;
  if (renaming) {
    const issue = await runDriver("portless", () => drivers.edge.removeAlias(oldName));
    if (issue) teardownIssues.push(issue);
  }

  // Every await above is done now: re-check existence, freshly reloaded,
  // before any of editApp's OWN writes below. The `record` snapshot at the
  // top of this function can go stale the moment a driver call is awaited:
  // a second writer (unregisterApp's DELETE, in particular) can delete this
  // exact record while teardown is in flight. A stale write must never
  // resurrect a deletion that already landed.
  reloadRegistry();
  if (!getRecord(oldName)) {
    return { status: 404, body: { error: "unknown app" } };
  }

  if (renaming) {
    deleteRecord(oldName);
    // Settings are keyed by app name, and an unknown name reads as
    // published:true with no password — so the entry has to travel with the
    // record, or renaming quietly publishes a private, password-protected app
    // the moment the new hostname goes live.
    renameAppSettings(oldName, next.name);
    // The sign-in rule is keyed by name too, and an unknown name reads as
    // { mode: "off" } — without this the emails/domains allowlist is silently
    // dropped the moment the renamed hostname goes live.
    renameOAuth(oldName, next.name);
  }
  if (portChanged) clearOverride(next.name);
  putRecord(next);
  if (next.kind === "service") {
    await tryDriver(next.name, "launchd", () => drivers.manager.install(specFor(next)));
  }
  // Unchanged base port + an active override: the live route stays pointed at
  // the override's devPort instead of being reset to the base port. A changed
  // base port has already cleared the override above, so there's nothing to
  // prefer; alias straight to the new base port.
  const liveOverride = portChanged ? undefined : getOverride(next.name);
  await tryDriver(next.name, "portless", () => drivers.edge.alias(next.name, liveOverride?.devPort ?? next.port));
  // Teardown issues land last, against the record that actually got persisted.
  // After the stand-up calls, too: tryDriver clears its source on success, and a
  // teardown failure (say an orphaned launchd service the uninstall left behind)
  // is still unresolved no matter how well the new shape installed.
  for (const issue of teardownIssues) addIssue(next.name, issue);
  return { status: 200, body: { record: getRecord(next.name) } };
}

/**
 * Re-render every supervised app's plist against the current environment.
 *
 * A plist is written once at registration and then never revisited, so an app
 * registered while one toolchain was installed keeps naming that toolchain's
 * paths after it moves or is replaced — and launchd simply declines to start
 * it, silently. Re-rendering resolves each record's logical command again,
 * which is what makes such a change self-healing instead of a support ticket.
 *
 * The platform's own service is excluded on purpose: bootstrapSelf owns that
 * plist and the uninstall/install ordering around a live platform, which is
 * deliberately not this sweep's to repeat.
 */
export async function reinstallSupervised(
  drivers: Drivers,
): Promise<{ reinstalled: string[]; failed: string[] }> {
  const reinstalled: string[] = [];
  const failed: string[] = [];
  for (const record of listRecords()) {
    if (record.kind !== "service" || isPlatformManagedBy(record.managedBy)) continue;
    if (!record.label || !record.command?.length) continue;
    try {
      await drivers.manager.install(specFor(record));
      clearIssues(record.name, "launchd");
      reinstalled.push(record.name);
    } catch (err) {
      addIssue(record.name, {
        source: "launchd",
        message: String(err).slice(0, 300),
        at: new Date().toISOString(),
      });
      failed.push(record.name);
    }
  }
  return { reinstalled, failed };
}
