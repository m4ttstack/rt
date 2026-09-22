/**
 * rt's own baseline plugin set. Lives apart from `steps/plugins.ts` so the
 * `tool.plugins` validator can watch exactly what `plugins.install` installs
 * without a validator importing a step (or a second copy of the list drifting
 * from the first).
 */
export const BASE_PLUGINS: string[] = [
  "mattstack@mattstack",
  "fast-browser@mattstack",
  "chat@mattstack",
  // The mattstack skills and every compiled team pack invoke superpowers:*
  // skills; without it a pipeline dies mid-run on a missing skill.
  "superpowers@claude-plugins-official",
];

/**
 * Other ids that ARE the same plugin. Installing the baseline id beside one
 * would register a second plugin under the same skill namespace. An explicit
 * list, never a name match: a lookalike marketplace must not satisfy a
 * baseline entry.
 */
const BASE_PLUGIN_ALTERNATES: Record<string, string[]> = {
  "superpowers@claude-plugins-official": ["superpowers@superpowers-marketplace"],
};

/** The id to install, update, and check for a baseline entry: itself when present or when nothing equivalent is, else the installed alternate. */
export function resolveBasePlugin(id: string, installed: (id: string) => boolean): string {
  if (installed(id)) return id;
  return (BASE_PLUGIN_ALTERNATES[id] ?? []).find(installed) ?? id;
}
