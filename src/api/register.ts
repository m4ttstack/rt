import { mkdirSync } from "fs";
import { join } from "path";
import { readRoutes, readServices } from "../../core/discover.ts";
import {
  getRecord, putRecord, deleteRecord, listRecords, addIssue, type AppRecord,
} from "../registry/records.ts";
import { allocatePort } from "../registry/allocate.ts";
import { authorizeStructural } from "../registry/lifecycle.ts";
import { LABEL_PREFIX, type ServiceManager, type ServiceSpec } from "../services/manager.ts";
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

function specFor(record: AppRecord): ServiceSpec {
  return {
    label: record.label!,
    programArguments: record.command!,
    workingDirectory: record.workingDirectory!,
    environment: { ...(record.env ?? {}), PORT: String(record.port) },
    stdoutPath: join(logsDir(), `${record.name}.out.log`),
    stderrPath: join(logsDir(), `${record.name}.err.log`),
  };
}

/** Loud degradation: run a driver call, convert failure into a recorded issue. */
async function tryDriver(
  name: string,
  source: "portless" | "launchd",
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    addIssue(name, { source, message: String(err).slice(0, 300), at: new Date().toISOString() });
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
    (!input.adopt && routes.some((r) => r.hostname.split(".")[0] === name));
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

export async function unregisterApp(
  name: string,
  caller: string,
  force: boolean,
  drivers: Drivers,
): Promise<FlowResult> {
  const record = getRecord(name);
  if (!record) return { status: 404, body: { error: "unknown app" } };
  const verdict = authorizeStructural(record, caller, force);
  if (!verdict.ok) return { status: verdict.status, body: verdict.body };

  if (record.kind === "service" && record.label) {
    await tryDriver(name, "launchd", () => drivers.manager.uninstall(record.label!));
  }
  await tryDriver(name, "portless", () => drivers.edge.removeAlias(name));
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

  if (next.kind === "service" && oldLabel) {
    await tryDriver(oldName, "launchd", () => drivers.manager.uninstall(oldLabel));
  }
  if (next.name !== oldName) {
    await tryDriver(oldName, "portless", () => drivers.edge.removeAlias(oldName));
    deleteRecord(oldName);
  }
  putRecord(next);
  if (next.kind === "service") {
    await tryDriver(next.name, "launchd", () => drivers.manager.install(specFor(next)));
  }
  await tryDriver(next.name, "portless", () => drivers.edge.alias(next.name, next.port));
  return { status: 200, body: { record: getRecord(next.name) } };
}
