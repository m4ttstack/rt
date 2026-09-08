import { useEffect, useState } from 'react';
import { Text } from '@mattstack/app-kit/core';
import { navigate } from 'wouter/use-browser-location';

import { client } from '../api';

/** `/gates/:id` carries no content of its own -- a gate notification's only
    known coordinate is the gate id, so this looks up the run it belongs to
    and hands off to `/runs/<repo>/<runId>?gate=<id>` with history replaced
    (back/forward should never land back on this stub). The `gate` param
    rides along for `RunDetail`'s own scroll-to-card effect. */
export function GateRedirect({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        const res = await client.api.gates[':id'].locate.$get({
          param: { id },
        });
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(body?.error ?? `locate failed (${res.status})`);
          return;
        }
        const { repo, runId } = await res.json();
        navigate(`/runs/${repo}/${runId}?gate=${id}`, { replace: true });
      } catch {
        if (!cancelled) setError('locate failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <Text c="bad" p="xl" data-testid="gate-redirect-error">
        {error}
      </Text>
    );
  }
  return null;
}
