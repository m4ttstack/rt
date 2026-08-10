import { join } from "path";
import { mkdirSync } from "fs";
import { readRoutes, readServices } from "../../core/discover.ts";
import { PLATFORM_LABEL } from "../services/manager.ts";
import { allocatePort } from "./allocate.ts";
import { listRecords, getRecord, putRecord } from "./records.ts";
import { registerApp, type Drivers } from "../api/register.ts";
import { stateDir, logsDir } from "../api/state.ts";

export interface BootstrapResult {
  port: number;
  label: string;
  aliases: string[];
}

/**
 * Local eats its own contract (ruled). This is the ONE legitimate self-write:
 * the agent and route go in before the registry exists, then the record catches
 * up immediately via the ordinary register flow in adopt mode. Everything after
 * this moment goes through the API like any other app. Self-heal is launchd's
 * KeepAlive; Local cannot heal itself from inside.
 */
export async function bootstrapSelf(
  drivers: Drivers,
  opts: { execPath: string; entry: string | null; tlds: string[] },
): Promise<BootstrapResult> {
  const existing = getRecord("local");
  const port =
    existing?.port ??
    allocatePort(listRecords(), readRoutes(), await readServices());
  if (port === null) throw new Error("port range exhausted");

  mkdirSync(logsDir(), { recursive: true });
  const programArguments = opts.entry
    ? [opts.execPath, opts.entry, "serve"] // checkout mode: bun + src/main.ts
    : [opts.execPath, "serve"]; // compiled binary
  await drivers.manager.install({
    label: PLATFORM_LABEL,
    programArguments,
    workingDirectory: stateDir(),
    environment: { PORT: String(port) },
    stdoutPath: join(logsDir(), "local.out.log"),
    stderrPath: join(logsDir(), "local.err.log"),
  });

  const aliases = ["local"];
  if (!opts.tlds.includes("mattstack")) aliases.push("local.mattstack");
  for (const alias of aliases) await drivers.edge.alias(alias, port);

  // Record catch-up, fresh bootstrap only: adopt mode writes the row without
  // re-running the drivers. Adopt skips the route-conflict check (the alias we
  // JUST wrote above is the route it would otherwise collide with), but the
  // status still gets checked: a silent failure here would leave Local serving
  // with no record of itself. On a re-run (reinstall/upgrade/retry) the record
  // already exists, and registering it again would 409 against itself, so the
  // field patch below is the whole catch-up that is still owed.
  if (!existing) {
    const result = await registerApp(
      { name: "local", managedBy: "local", staticPort: port, adopt: true },
      drivers,
    );
    if (result.status !== 201) {
      throw new Error(`self record catch-up failed (${result.status}): ${JSON.stringify(result.body)}`);
    }
  }
  // The adopt path wrote kind external; the self record is a supervised
  // service. One write path for both a fresh bootstrap and a re-run, so a
  // re-run also re-asserts these fields if something drifted them.
  const rec = getRecord("local")!;
  rec.kind = "service";
  rec.label = PLATFORM_LABEL;
  rec.command = programArguments;
  rec.workingDirectory = stateDir();
  putRecord(rec);

  return { port, label: PLATFORM_LABEL, aliases };
}
