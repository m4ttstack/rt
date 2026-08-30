import { readDeckManifest, resolveServeShape } from "../registry/deck-manifest.ts";
import { getRecord, putRecord } from "../registry/records.ts";
import { registerApp, editApp, type Drivers, type FlowResult } from "./register.ts";
import { ingestManifest } from "../registry/manifest.ts";

/**
 * Mirror a record to its manifest. The single flow behind both `deck register`
 * (activeAlt undefined = base serve shape) and `deck alt` (activeAlt = an
 * overlay name, or undefined to return to base). The manifest is the source of
 * truth: every field it declares is (re)written; register clears an active alt
 * because the base serve shape is the manifest's canonical one.
 */
export async function applyManifest(
  dir: string,
  activeAlt: string | undefined,
  drivers: Drivers,
): Promise<FlowResult> {
  const parsed = readDeckManifest(dir);
  if (parsed === null) return { status: 400, body: { error: "no mattstack.deck.json in " + dir } };
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const manifest = parsed.manifest;

  let shape: { port?: number; command?: string[] };
  try {
    shape = resolveServeShape(manifest, activeAlt);
  } catch (e) {
    return { status: 400, body: { error: String((e as Error).message) } };
  }

  const { start: _start, ...actionCommands } = manifest.commands;
  const existing = getRecord(manifest.name);

  if (!existing) {
    // A manifest with neither a start command nor a port declares nothing to stand up.
    if (!shape.command && shape.port === undefined) {
      return { status: 400, body: { error: "manifest must declare commands.start or a port" } };
    }
    const created = await registerApp(
      shape.command
        ? { name: manifest.name, command: shape.command, workingDirectory: dir, port: shape.port, env: manifest.env }
        : { name: manifest.name, staticPort: shape.port! },
      drivers,
    );
    if (created.status !== 201) return created;
  } else if (shape.command) {
    // Serve shape (command/port) can change between runs and on alt switches;
    // editApp tears the old launchd service down and stands the new one up.
    // register/alt must be able to sync a MANAGED app from the local-only user
    // CLI, so the caller is the app's own manager with force=true to clear
    // authorizeStructural (mirrors adoptApp's force-bless). Safe because the
    // whole mutation plane is 127.0.0.1-local and public mutations are already 403'd.
    if (existing.kind !== "service") {
      // external -> service: editApp keeps a record's kind, so it would set the
      // command but never install launchd, leaving a route-only app with a
      // command and no running service. Refuse loudly instead of half-applying.
      return {
        status: 400,
        body: { error: `cannot add commands.start to route-only app ${manifest.name} via register; run \`deck remove ${manifest.name}\` then re-register` },
      };
    }
    const edited = await editApp(
      manifest.name,
      // env: `?? {}` rather than undefined, because editApp keeps the record's old
      // env on undefined and the manifest is the source of truth: dropping env
      // from the manifest must clear it on the service, not silently retain it.
      { command: shape.command, workingDirectory: dir, env: manifest.env ?? {}, ...(shape.port !== undefined && { port: shape.port }) },
      existing.managedBy,
      true,
      drivers,
    );
    if (edited.status !== 200) return edited;
  } else if (existing.kind === "service") {
    // service -> route-only: the manifest dropped commands.start on a supervised
    // app. Tearing a live service down to route-only is a structural change
    // editApp does not perform; silently keeping the old service is worse than
    // refusing. `deck remove` + re-register is the explicit path.
    return {
      status: 400,
      body: { error: `cannot drop commands.start on supervised app ${manifest.name} via register; run \`deck remove ${manifest.name}\` then re-register as route-only` },
    };
  } else if (shape.port !== undefined && shape.port !== existing.port) {
    // Port-only (external) app whose declared or overlay port changed: propagate
    // the new port and route alias. editApp's external path updates the alias
    // without touching launchd, so `deck alt` actually re-routes a port-only app
    // instead of returning success while the route stays on the old port.
    const edited = await editApp(manifest.name, { port: shape.port }, existing.managedBy, true, drivers);
    if (edited.status !== 200) return edited;
  }

  // Metadata the serve-shape flows above do not carry: action commands, the
  // declared overlays, and which overlay is live. Written last, over whatever
  // registerApp/editApp persisted.
  const record = getRecord(manifest.name)!;
  putRecord({
    ...record,
    commands: Object.keys(actionCommands).length ? actionCommands : undefined,
    altConfigs: manifest.altConfigs,
    activeAlt,
  });
  ingestManifest(manifest.name);
  return { status: 200, body: { record: getRecord(manifest.name) } };
}
