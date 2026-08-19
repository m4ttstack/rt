import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { BoardConfig } from "./config.ts";
import { projectPathFromWebUrl } from "./data.ts";
import { stripJsonc } from "./team-zone.ts";

export type BoardSkillKind = "review" | "respond" | "doctor";

export interface ResolvedBoardSkill {
  skill: string;
  source: "manifest" | "config";
}

const CONFIG_FIELD: Record<BoardSkillKind, "reviewSkill" | "respondSkill" | "doctorSkill"> = {
  review: "reviewSkill",
  respond: "respondSkill",
  doctor: "doctorSkill",
};

/** Slug a GitLab host + project path into the `~/.mattstack/repos/<slug>` dir
    name a per-repo manifest lives under: the host (scheme stripped,
    credentials stripped, truncated at the first "/", lowercased) and the
    project path joined by "-", with every "/" in the project path also
    replaced by "-". E.g. "https://gitlab.com" + "acme/acme-dev" ->
    "gitlab.com-acme-acme-dev". Normalization matches
    merge-manifests.sh's norm_url so a trailing slash or embedded
    credentials on `gitlabHost` still resolve the same manifest. */
export function boardRepoSlug(gitlabHost: string, project: string): string {
  const host = gitlabHost
    .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "")
    .replace(/^[^@/]*@/, "")
    .split("/")[0]!
    .toLowerCase();
  return `${host}-${project.replace(/\//g, "-")}`;
}

/**
 * Resolve which skill a board launch (review/respond/doctor) should use for
 * `project`: the per-repo mattstack manifest's `mr-board:<kind>` binding when
 * present and a non-empty string, else `cfg`'s own skill field for `kind`.
 *
 * Never throws. A missing manifest file, a manifest that fails to parse, an
 * absent `bindings["mr-board:<kind>"]`, or an empty `skill` value are all
 * silent falls back to config -- the board must never break because a
 * repo's manifest is absent or malformed.
 */
export function resolveBoardSkill(
  kind: BoardSkillKind,
  project: string,
  cfg: BoardConfig,
  mattstackHome?: string,
): ResolvedBoardSkill {
  const configSkill = cfg[CONFIG_FIELD[kind]];
  const fallback: ResolvedBoardSkill = { skill: configSkill, source: "config" };

  const home = mattstackHome ?? join(homedir(), ".mattstack");
  const slug = boardRepoSlug(cfg.gitlabHost, project);
  const manifestPath = join(home, "repos", slug, "skills.jsonc");
  if (!existsSync(manifestPath)) return fallback;

  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(raw));
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;

  const bindings = (parsed as Record<string, unknown>).bindings;
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) return fallback;

  const binding = (bindings as Record<string, unknown>)[`mr-board:${kind}`];
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return fallback;

  const skill = (binding as Record<string, unknown>).skill;
  if (typeof skill !== "string" || skill === "") return fallback;

  return { skill, source: "manifest" };
}

/** Resolve + log which skill a launch (review/respond/doctor) should use for
    the MR at `mrUrl`: derives its project from the webUrl and defers to
    resolveBoardSkill, falling back to config when the project can't be
    parsed out of the URL. Shared by every launch site -- the board's own
    HTTP launches (server.ts) and triage's nudge-driven re-review launches
    (bin/triage.ts) -- so the "<kind> skill: <skill> (<source>)" log line has
    one place. */
export function resolveLaunchSkill(kind: BoardSkillKind, mrUrl: string, cfg: BoardConfig, mattstackHome?: string): string {
  const project = projectPathFromWebUrl(mrUrl, cfg.gitlabHost);
  const resolved = project
    ? resolveBoardSkill(kind, project, cfg, mattstackHome)
    : { skill: cfg[CONFIG_FIELD[kind]], source: "config" as const };
  console.log(`${kind} skill: ${resolved.skill} (${resolved.source})`);
  return resolved.skill;
}
