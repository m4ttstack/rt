import { join } from "path";
import { mkdirSync } from "fs";
import { readRoutes, readServices } from "../../core/discover.ts";
import {
  PLATFORM_LABEL, PLATFORM_NAME, LEGACY_PLATFORM_LABEL, LEGACY_PLATFORM_NAME,
} from "../services/manager.ts";
import { allocatePort } from "./allocate.ts";
import { listRecords, getRecord, deleteRecord, putRecord } from "./records.ts";
import { registerApp, type Drivers } from "../api/register.ts";
import { stateDir, logsDir } from "../api/state.ts";

export interface BootstrapResult {
  port: number;
  label: string;
  aliases: string[];
}

/**
 * Deck eats its own contract (ruled). This is the ONE legitimate self-write:
 * the agent and route go in before the registry exists, then the record catches
 * up immediately via the ordinary register flow in adopt mode. Everything after
 * this moment goes through the API like any other app. Self-heal is launchd's
 * KeepAlive; Deck cannot heal itself from inside.
 */
export async function bootstrapSelf(
  drivers: Drivers,
  opts: { execPath: string; entry: string | null; tlds: string[] },
): Promise<BootstrapResult> {
  // Local -> Deck rename (ruled): an upgrading machine's self-row may still
  // be on disk under the pre-rename identity (name/managedBy "local"). Look
  // for it under the new name first, then fall back to the old one, so its
  // port is reused rather than re-allocated.
  const existing = getRecord(PLATFORM_NAME) ?? getRecord(LEGACY_PLATFORM_NAME);
  const port =
    existing?.port ??
    allocatePort(listRecords(), readRoutes(), await readServices());
  if (port === null) throw new Error("port range exhausted");

  // Migration requirement: boot the pre-rename platform label out before
  // installing the new one, so an upgrading machine never ends up running
  // both platform agents at once. uninstall() is idempotent teardown
  // (services/launchd.ts): a no-op when that label was never installed, so
  // this is safe to call unconditionally on every boot, not just upgrades.
  await drivers.manager.uninstall(LEGACY_PLATFORM_LABEL);

  mkdirSync(logsDir(), { recursive: true });
  const programArguments = opts.entry
    ? [opts.execPath, opts.entry, "serve"] // checkout mode: bun + src/main.ts
    : [opts.execPath, "serve"]; // compiled binary
  await drivers.manager.install({
    label: PLATFORM_LABEL,
    programArguments,
    workingDirectory: stateDir(),
    // launchd starts agents with its own minimal PATH ($PATH pared down to
    // the OS defaults), not the installing shell's, so anything the running
    // platform later shells out to (portless, in particular; this broke live)
    // needs the real PATH captured here, at `deck setup` time, while
    // process.env.PATH still holds the shell's actual value.
    environment: { PORT: String(port), PATH: process.env.PATH ?? "" },
    stdoutPath: join(logsDir(), "deck.out.log"),
    stderrPath: join(logsDir(), "deck.err.log"),
  });

  const aliases = [PLATFORM_NAME];
  if (!opts.tlds.includes("mattstack")) aliases.push(`${PLATFORM_NAME}.mattstack`);
  for (const alias of aliases) await drivers.edge.alias(alias, port);

  // Record catch-up, fresh bootstrap only: adopt mode writes the row without
  // re-running the drivers. Adopt skips the route-conflict check (the alias we
  // JUST wrote above is the route it would otherwise collide with), but the
  // status still gets checked: a silent failure here would leave Deck serving
  // with no record of itself. On a re-run (reinstall/upgrade/retry) the record
  // already exists, and registering it again would 409 against itself, so the
  // field patch below is the whole catch-up that is still owed.
  if (!existing) {
    const result = await registerApp(
      { name: PLATFORM_NAME, managedBy: PLATFORM_NAME, staticPort: port, adopt: true },
      drivers,
    );
    if (result.status !== 201) {
      throw new Error(`self record catch-up failed (${result.status}): ${JSON.stringify(result.body)}`);
    }
  } else if (existing.name !== PLATFORM_NAME) {
    // Migrate the pre-rename self-row's KEY too, not just its fields below:
    // putRecord() writes under record.name, so leaving this as "local" would
    // create a second row instead of relabeling this one in place.
    deleteRecord(existing.name);
    putRecord({ ...existing, name: PLATFORM_NAME });
  }
  // The adopt path wrote kind external; the self record is a supervised
  // service. One write path for both a fresh bootstrap and a re-run, so a
  // re-run also re-asserts these fields if something drifted them (the
  // managedBy id, in particular, for a record migrated from "local" above).
  const rec = getRecord(PLATFORM_NAME)!;
  rec.kind = "service";
  rec.label = PLATFORM_LABEL;
  rec.managedBy = PLATFORM_NAME;
  rec.command = programArguments;
  rec.workingDirectory = stateDir();
  putRecord(rec);

  return { port, label: PLATFORM_LABEL, aliases };
}
