import type { AppRecord } from "./records.ts";

/** Manager ids are generic; display names make the 409 read like the product. */
export const MANAGER_DISPLAY: Record<string, string> = { rt: "mattstack" };

export type StructuralVerdict =
  | { ok: true }
  | {
      ok: false;
      status: 409;
      body: { error: "managed"; managedBy: string; message: string; escapeHatch: string };
    };

/**
 * The managed-vs-user contract, enforced AT the API (ruled): the registrar owns
 * structure; operations stay universal and never come through here. `force` is
 * the documented escape hatch the 409 body advertises.
 */
export function authorizeStructural(
  record: Pick<AppRecord, "name" | "managedBy">,
  caller: string,
  force: boolean,
): StructuralVerdict {
  if (force || record.managedBy === caller) return { ok: true };
  const message =
    record.managedBy === "local"
      ? "This is Local itself: `lcl uninstall`"
      : record.managedBy === "user"
        ? `Managed by user: remove it from the board or \`lcl remove ${record.name}\``
        : `Managed by ${MANAGER_DISPLAY[record.managedBy] ?? record.managedBy} — \`${record.managedBy} uninstall ${record.name}\``;
  return {
    ok: false,
    status: 409,
    body: { error: "managed", managedBy: record.managedBy, message, escapeHatch: "?force=true" },
  };
}
