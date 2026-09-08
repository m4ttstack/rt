/** Pure helpers behind the `?gate=<id>` deep link -- the DOM effect (scroll,
    flash, strip) that consumes them lives in Board.tsx. */

/** The `gate` query param, or null when absent or empty. */
export function gateParam(search: string): string | null {
  const value = new URLSearchParams(search).get('gate');
  return value ? value : null;
}

/** The iid of the row whose gates carry `gateId`, or null when no row does. */
export function mrForGate(
  mrs: Array<{ iid: number; gates?: Array<{ gateId: string }> }>,
  gateId: string
): number | null {
  const hit = mrs.find(mr => mr.gates?.some(g => g.gateId === gateId));
  return hit ? hit.iid : null;
}

/** `search` without its `gate` param; every other param rides along untouched. */
export function stripGateParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('gate');
  const s = params.toString();
  return s ? `?${s}` : '';
}
