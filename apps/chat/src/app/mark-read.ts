/** Advances the human's read cursor for a room. Callers refetch rooms only
    after this resolves: the count clears server-side first, and a refetch
    fired earlier would read the stale unread. */
export async function postMarkRead(room: string): Promise<void> {
  // fetch resolves on a 4xx/5xx too; a non-ok mark-read left the cursor
  // unmoved server-side, so throw rather than let the caller refetch and
  // read the still-stale count as if it had cleared.
  const res = await fetch('/api/chat/mark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room }),
  });
  if (!res.ok) throw new Error(`mark-read failed: HTTP ${res.status}`);
}
