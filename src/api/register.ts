import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { readRoutes, readServices, bareName, MATTSTACK_TLD, type PortlessRoute } from "../../core/discover.ts";
import { reconcileMattstackTld } from "./tld-reconcile.ts";
import { getPlatformSettings } from "./platform-settings.ts";
import {
  getRecord, putRecord, deleteRecord, listRecords, addIssue, clearIssues, reloadRegistry,
  type AppRecord, type SyncIssue,
} from "../registry/records.ts";
import { readDeckManifest } from "../registry/deck-manifest.ts";
import { ingestManifest, removeIcon } from "../registry/manifest.ts";
import { renameAppSettings, getOverride, clearOverride } from "../../core/settings.ts";
import { renameOAuth } from "../edge/oauth.ts";
import { allocatePort } from "../registry/allocate.ts";
import { authorizeStructural } from "../registry/lifecycle.ts";
import { resetDevModeCache } from "./dev-mode.ts";
import {
  LABEL_PREFIX, isPlatformManagedBy, type ServiceManager, type ServiceSpec,
} from "../services/manager.ts";
import { composeServicePath, resolveProgram } from "../services/exec-env.ts";
import { readInstalledProgramArguments } from "../services/launchd.ts";
import { serveShape, type ResolvedShape, type ServeShapeDeps } from "../registry/serve-shape.ts";
import type { EdgeProxy } from "../edge/portless.ts";
import { logsDir } from "./state.ts";
import { disableRemote } from "../edge/remote.ts";
import type { RailwayDriver } from "../edge/railway.ts";
import type { CfDns } from "../edge/cf-dns.ts";
import type { TunnelDriver } from "../edge/tunnel.ts";

export interface Drivers {
  manager: ServiceManager;
  edge: EdgeProxy;
  /** Only needed to remove a remote app: unregisterApp/removeManagedApps flip it back via disableRemote first. Resolved once per request via resolveRemoteDrivers (src/edge/remote.ts). */
  railway?: RailwayDriver;
  dns?: CfDns;
  /** Only needed for the edge teardown call in `deck uninstall`; see src/cli/setup.ts. */
  tunnel?: TunnelDriver;
}

export interface RegisterInput {
  name: string;
  managedBy?: string;
  command?: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
  /** For services someone runs themselves: route only, no launchd supervision. */
  staticPort?: number;
  /** A declared port for a supervised service (manifest register); wins over allocation. */
  port?: number;
  /** Record-only creation: no driver calls. Used by bootstrap catch-up and migrate. */
  adopt?: boolean;
}

export type FlowResult = { status: number; body: unknown };

const NAME_RE = /^[a-z0-9][a-z0-9.-]*$/;

/** Test seam: overrides the resolver's mode read; production leaves it unset. */
export let serveShapeDeps: ServeShapeDeps = {};
export function setServeShapeDeps(deps: ServeShapeDeps): void { serveShapeDeps = deps; }

/**
 * launchd does not search PATH for `ProgramArguments[0]`, so argv0 must be
 * absolute in the plist. The caller passes the shape resolved for this render
 * (bundled binary or linked source), and this resolves argv0 to an absolute
 * path on every render, so an interpreter that moves -- a version manager
 * reorganizing, or being swapped for another -- is picked up by the next
 * render instead of being frozen at registration.
 *
 * Throws rather than naming a program that does not exist: launchd declines
 * to start such a job without logging anything, so writing it anyway produces
 * an app that is silently, inexplicably down.
 */
function specFor(record: AppRecord, shape: ResolvedShape): ServiceSpec {
  const env = { ...(record.env ?? {}), PORT: String(record.port) };
  const path = env.PATH ?? composeServicePath();
  const [argv0, ...rest] = shape.command;
  const program = resolveProgram(argv0!, path);
  if (!program) throw new Error(`${argv0} not found on the service PATH (${path})`);
  return {
    label: record.label!,
    programArguments: [program, ...rest],
    workingDirectory: shape.cwd,
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

/**
 * True when `port` is already held by another record, a portless route, or a
 * launchd service. Used only for a manifest-declared SERVICE port
 * (`registerApp`'s `input.port`, `editApp`'s `patch.port`): `allocatePort`
 * never sees a caller-declared port, so nothing else guards against handing
 * out a port a real process is already bound to.
 */
async function portCollides(port: number, excludeName: string, routes: PortlessRoute[]): Promise<boolean> {
  if (listRecords().some((r) => r.name !== excludeName && r.port === port)) return true;
  const tlds = getPlatformSettings().tlds;
  if (routes.some((r) => bareName(r.hostname, tlds) !== excludeName && r.port === port)) return true;
  const services = await readServices();
  return services.some((s) => s.port === port);
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

  let port = input.staticPort ?? input.port;
  if (port === undefined) {
    const allocated = allocatePort(listRecords(), routes, await readServices());
    if (allocated === null) return { status: 507, body: { error: "port range exhausted" } };
    port = allocated;
  } else if (input.staticPort === undefined) {
    // A manifest-declared SERVICE port bypasses allocatePort's conflict
    // detection entirely, so it needs its own collision check here. staticPort
    // (external apps routing to something the user already runs) is exempt --
    // that's an intentional route onto someone else's process.
    if (await portCollides(port, name, routes)) {
      return { status: 409, body: { error: "port in use", port } };
    }
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
    if (isService) {
      const shape = serveShape(record, serveShapeDeps);
      if (shape) await tryDriver(name, "launchd", () => drivers.manager.install(specFor(record, shape)));
    }
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

/**
 * Shared by unregisterApp and removeManagedApps: when a record is in remote
 * (Railway) mode, flip it back to local BEFORE the caller runs teardownRecord.
 * A non-null return means the flip failed and the remove must abort right
 * there -- never proceed to teardownRecord, or the Railway service is orphaned.
 */
async function flipRemoteBack(record: AppRecord, drivers: Drivers): Promise<FlowResult | null> {
  if (!record.remote) return null;
  if (!drivers.railway || !drivers.dns) {
    throw new Error(`remote drivers missing: cannot remove remote app ${record.name}`);
  }
  const flip = await disableRemote(record.name, { railway: drivers.railway, dns: drivers.dns });
  return flip.status === 200 ? null : flip;
}

/** Shared by unregisterApp and removeManagedApps: tears down a record's launchd service and portless alias. */
async function teardownRecord(record: AppRecord, drivers: Drivers): Promise<{ ok: boolean }> {
  const issues: SyncIssue[] = [];
  if (record.kind === "service" && record.label) {
    const issue = await runDriver("launchd", () => drivers.manager.uninstall(record.label!));
    if (issue) issues.push(issue);
  }
  const portlessIssue = await runDriver("portless", () => drivers.edge.removeAlias(record.name));
  if (portlessIssue) issues.push(portlessIssue);

  if (issues.length > 0) {
    // Teardown didn't fully complete: keep the record (and the driver it
    // still owns, e.g. a launchd service that failed to uninstall) visible
    // on the board rather than silently deleting the evidence of failure.
    for (const issue of issues) addIssue(record.name, issue);
    return { ok: false };
  }
  deleteRecord(record.name);
  removeIcon(record.name);
  return { ok: true };
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

  const flipFailure = await flipRemoteBack(record, drivers);
  if (flipFailure) return flipFailure;

  const { ok } = await teardownRecord(record, drivers);
  return { status: 200, body: ok ? { ok: true } : { ok: false, record: getRecord(name) } };
}

/**
 * Bulk lifecycle verb behind `deck restart --managed`: the app calls this on
 * its own version-change kickstart (installer spec §8), so it targets every
 * non-user record directly -- the verb itself is the authorization boundary,
 * the way a single-app `--force` is.
 */
export async function restartManagedApps(drivers: Drivers): Promise<FlowResult> {
  const managed = listRecords().filter((r) => r.managedBy !== "user");
  const restarted: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (const record of managed) {
    if (record.kind !== "service" || !record.label) continue;
    try {
      // kickstart signals failure via its boolean return (label not
      // installed), not by throwing — same contract the single-app
      // POST /apps/:name/restart route relies on.
      const ok = await drivers.manager.kickstart(record.label);
      if (ok) restarted.push(record.name);
      else failed.push({ name: record.name, error: "kickstart failed" });
    } catch (err) {
      failed.push({ name: record.name, error: String(err).slice(0, 300) });
    }
  }
  return { status: 200, body: { ok: failed.length === 0, restarted, failed } };
}

/**
 * Selective restart behind a mattstack dev/prod mode flip: rt pokes this after
 * `rt settings dev-mode` changes, so every managed app must re-resolve its
 * shape, but only the ones whose resolved command actually moved get torn
 * down and rebuilt. The diff is against the installed plist's
 * ProgramArguments, not any last-resolved value on the record, so a flip and
 * a flip-back reads as the same "unchanged" outcome both times.
 */
export async function reresolveManagedApps(drivers: Drivers): Promise<FlowResult> {
  // rt writes mattstack.mode then pokes this route immediately; a status poll
  // in the preceding 2s can have already warmed isDevMode's cache with the
  // OLD mode, which would resolve every shape below unchanged.
  resetDevModeCache();
  const restarted: string[] = [];
  const unchanged: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (const record of listRecords()) {
    if (record.managedBy === "user" || record.kind !== "service" || !record.label) continue;
    // The platform never restarts itself mid-request; bootstrapSelf owns its shape.
    if (isPlatformManagedBy(record.managedBy)) continue;
    const shape = serveShape(record, serveShapeDeps);
    if (!shape) { failed.push({ name: record.name, error: "no runnable shape" }); continue; }
    let spec: ServiceSpec;
    try {
      spec = specFor(record, shape);
    } catch (err) {
      failed.push({ name: record.name, error: String(err).slice(0, 300) });
      continue;
    }
    const installed = readInstalledProgramArguments(record.label);
    if (installed !== null && installed.length === spec.programArguments.length
        && installed.every((a, i) => a === spec.programArguments[i])) {
      unchanged.push(record.name);
      continue;
    }
    // launchd has no atomic replace, so a failure between the two calls is a
    // real possibility, not just a defensive catch: an uninstall that throws
    // must not be followed by an install attempt (nothing to replace), and an
    // install that throws leaves the app down -- loud enough to survive past
    // this response body via a SyncIssue, the same convention editApp and
    // registerApp already use for their own install failures.
    const uninstallIssue = await runDriver("launchd", () => drivers.manager.uninstall(record.label!));
    if (uninstallIssue) {
      failed.push({ name: record.name, error: uninstallIssue.message });
      continue;
    }
    const installIssue = await runDriver("launchd", () => drivers.manager.install(spec));
    if (installIssue) {
      addIssue(record.name, installIssue);
      failed.push({ name: record.name, error: installIssue.message });
      continue;
    }
    clearIssues(record.name, "launchd");
    restarted.push(record.name);
  }
  return { status: 200, body: { ok: failed.length === 0, restarted, unchanged, failed } };
}

/**
 * Bulk lifecycle verb behind `deck remove --managed`: the app calls this
 * during `rt uninstall` (installer spec §12.3) to unregister every non-user
 * record deck supervises. Same implicit-authority model as restartManagedApps.
 */
export async function removeManagedApps(drivers: Drivers): Promise<FlowResult> {
  const managed = listRecords().filter((r) => r.managedBy !== "user");
  const removed: string[] = [];
  const failed: string[] = [];
  for (const record of managed) {
    const flipFailure = await flipRemoteBack(record, drivers);
    if (flipFailure) { failed.push(record.name); continue; }
    const { ok } = await teardownRecord(record, drivers);
    if (ok) removed.push(record.name);
    else failed.push(record.name);
  }
  return { status: 200, body: { ok: failed.length === 0, removed, failed } };
}

export async function editApp(
  name: string,
  patch: {
    name?: string; command?: string[]; workingDirectory?: string; env?: Record<string, string>; port?: number;
    dev?: { workingDirectory: string } | null;
  },
  caller: string,
  force: boolean,
  drivers: Drivers,
): Promise<FlowResult> {
  const record = getRecord(name);
  if (!record) return { status: 404, body: { error: "unknown app" } };

  // Computed from the patch's own keys, not a hand-listed set of the other
  // fields: a future patch field must not be silently swept into this carve-out.
  const devOnly = Object.keys(patch).length === 1 && Object.prototype.hasOwnProperty.call(patch, "dev");
  if (patch.dev != null) {
    const dir = patch.dev.workingDirectory;
    if (typeof dir !== "string" || !dir.startsWith("/")) {
      return { status: 400, body: { error: "dev.workingDirectory must be an absolute path" } };
    }
    if (!existsSync(dir)) return { status: 400, body: { error: "directory not found", dir } };
    const parsed = readDeckManifest(dir);
    if (parsed === null) return { status: 400, body: { error: `no mattstack.deck.json in ${dir}` } };
    if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
    if (parsed.manifest.name !== record.name) {
      return { status: 400, body: { error: "manifest name mismatch", expected: record.name, got: parsed.manifest.name } };
    }
  }
  // bootstrapSelf owns the platform's serve shape and plist, so a dev-only PATCH
  // on the platform's own record is a record-only write here: it must never
  // reach the label rewrite or the driver teardown/stand-up below.
  if (devOnly && isPlatformManagedBy(record.managedBy)) {
    putRecord({ ...record, dev: patch.dev === null ? undefined : (patch.dev ?? record.dev) });
    return { status: 200, body: { record: getRecord(record.name) } };
  }
  // The link is developer-local machine state, not registrar-owned structure,
  // and the mutation plane is already 127.0.0.1-only with public writes 403'd --
  // but any patch that also touches a structural field keeps the gate.
  if (!devOnly) {
    const verdict = authorizeStructural(record, caller, force);
    if (!verdict.ok) return { status: verdict.status, body: verdict.body };
  }
  if (patch.name !== undefined && !NAME_RE.test(patch.name)) {
    return { status: 400, body: { error: "bad name" } };
  }
  if (patch.name && patch.name !== name && getRecord(patch.name)) {
    return { status: 409, body: { error: "name taken", name: patch.name } };
  }
  if (patch.port !== undefined && (!Number.isInteger(patch.port) || patch.port < 1 || patch.port > 65535)) {
    return { status: 400, body: { error: "bad port" } };
  }
  if (patch.port !== undefined && patch.port !== record.port && record.kind === "service") {
    // External (staticPort-originated) records route to a port the user
    // already owns and runs themselves -- same exemption registerApp gives
    // staticPort. Only a supervised service's declared port needs guarding.
    if (await portCollides(patch.port, record.name, readRoutes())) {
      return { status: 409, body: { error: "port in use", port: patch.port } };
    }
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
    dev: patch.dev === null ? undefined : (patch.dev ?? record.dev),
  };
  if (next.kind === "service") next.label = `${LABEL_PREFIX}${next.name}`;
  // A dev-port override lives entirely in settings, keyed off the app's base
  // port at the time it was set. If this edit actually changes the base port,
  // that captured basePort is now stale... a later "clear override" would
  // revert to the wrong port, so the edit drops the override rather than
  // leave it silently wrong.
  const portChanged = next.port !== record.port;

  // Never uninstall the old shape unless the patch is guaranteed to leave a
  // runnable one: resolve the prospective shape before any teardown call, not
  // after, or a patch that resolves to nothing tears down with nothing to fall
  // back on.
  if (next.kind === "service" && !serveShape(next, serveShapeDeps)) {
    return {
      status: 400,
      body: { error: `edit would leave ${next.name} with no runnable shape (no bundle, no valid source)` },
    };
  }

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
    const shape = serveShape(next, serveShapeDeps);
    if (shape) await tryDriver(next.name, "launchd", () => drivers.manager.install(specFor(next, shape)));
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
 * Adopt a user-registered app as a mattstack product: optionally rename it to
 * its canonical product name, stamp managedBy (any non-"user" value flips the
 * row to name.mattstack and hands structural ownership to that manager), and
 * ensure the .mattstack route. Force-blessed by design — adoption is an
 * explicit ownership claim, and idempotent re-runs must succeed against the
 * already-managed record a first run produced, which authorizeStructural
 * would otherwise refuse from user context.
 *
 * Idempotency contract (pinned with the installer, L1 T25): re-running after
 * success answers 200 with changed:false and still re-ensures the .mattstack
 * route, so the installer's apply step can run it on every pass. The failure
 * `error` strings are frozen literals the installer matches on.
 */
export async function adoptApp(
  name: string,
  opts: { as?: string; managedBy?: string },
  drivers: Drivers,
): Promise<FlowResult> {
  const target = opts.as ?? name;
  const managedBy = opts.managedBy ?? "rt";
  if (!NAME_RE.test(target)) return { status: 400, body: { error: "bad name" } };
  if (managedBy === "user") return { status: 400, body: { error: "bad managedBy" } };

  const summary = (rec: AppRecord, previousName: string, changed: boolean) => ({
    adopted: true,
    changed,
    app: {
      name: rec.name,
      previousName,
      managedBy: rec.managedBy,
      port: rec.port,
      kind: rec.kind,
      label: rec.label,
    },
    hostnames: [`${rec.name}.${MATTSTACK_TLD}`, `${rec.name}.localhost`],
    issues: rec.issues ?? [],
  });

  const record = getRecord(name);
  if (!record) {
    const already = getRecord(target);
    if (already && already.managedBy === managedBy) {
      reconcileMattstackTld();
      return { status: 200, body: summary(getRecord(target)!, name, false) };
    }
    return { status: 404, body: { error: "unknown app" } };
  }

  const renaming = target !== name;
  if (renaming && getRecord(target)) return { status: 409, body: { error: "name taken", name: target } };

  let changed = false;
  if (renaming) {
    const r = await editApp(name, { name: target }, managedBy, true, drivers);
    if (r.status !== 200) return r;
    changed = true;
  }
  const current = getRecord(target)!;
  if (current.managedBy !== managedBy) {
    putRecord({ ...current, managedBy });
    changed = true;
  }
  // Pull the app's launcher metadata (mattstack.json + icon) into the registry
  // now that it is a managed product. Outside the managedBy guard above, so an
  // idempotent re-adopt and the rename path both refresh the metadata. A
  // missing or bad manifest is a quiet skip inside ingestManifest, so adopt
  // never fails on it.
  ingestManifest(target);
  reconcileMattstackTld();
  return { status: 200, body: summary(getRecord(target)!, name, changed) };
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
    if (record.kind !== "service" || isPlatformManagedBy(record.managedBy) || !record.label) continue;
    const shape = serveShape(record, serveShapeDeps);
    if (!shape) { failed.push(record.name); continue; }
    try {
      await drivers.manager.install(specFor(record, shape));
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
