import {
  isLocalRequest,
  type LocalServer,
} from '@mattstack/app-server/local-request';
import { getSetting } from '@mattstack/rt-client';
import {
  settingsHandler,
  type SettingsHandlerOptions,
} from '@mattstack/settings-kit/server';
import { Hono } from 'hono';

/**
 * Console's three typed reads, then settings-kit for defs/explain/set/unset.
 * The typed routes must be registered first: Hono matches in order, and the
 * catch-all would otherwise answer them with a 404.
 */
export function createSettingsRoutes(
  kit: Omit<SettingsHandlerOptions, 'allowWrite'> = {}
) {
  return (
    new Hono()
      .get('/api/settings/runs-prune-days', c => {
        const { value } = getSetting<number>('rt.runsPruneDays');
        return c.json({ days: value }, 200);
      })
      /** The suite-wide editor id (rt.workspacePrefs.defaultEditor, shared with
          `rt code`), for building open-in-editor hrefs. A resolver throw (an
          unexpandable ${...} in some other pref field) degrades to null, the
          same "no preference" the client falls back from. */
      .get('/api/settings/default-editor', c => {
        let editor: string | null;
        try {
          const { value } = getSetting<{ defaultEditor?: unknown } | undefined>(
            'rt.workspacePrefs'
          );
          // The registry validates rt.workspacePrefs only as a top-level object,
          // so a non-string defaultEditor can be stored; forward only strings.
          editor =
            typeof value?.defaultEditor === 'string'
              ? value.defaultEditor
              : null;
        } catch {
          editor = null;
        }
        return c.json({ editor }, 200);
      })
      /** The Linear workspace slug, so the client can build an issue url for a
          ticket the branch cache never enriched. Team-scoped and nested, so it
          is read off the integrations object rather than given its own key. */
      .get('/api/settings/linear-workspace', c => {
        const { value } = getSetting<{ linear?: { workspace?: string } }>(
          'mattstack.integrations'
        );
        return c.json({ workspace: value?.linear?.workspace ?? null }, 200);
      })
      .all('/api/settings/*', async c => {
        // Under Bun.serve, Hono's `c.env` is the Bun server, which lets the
        // locality gate check the socket peer, not just the forgeable Host.
        const res = await settingsHandler(c.req.raw, {
          allowComposite: 'shaped',
          ...kit,
          allowWrite: req =>
            isLocalRequest(req, c.env as LocalServer | undefined),
        });
        return res ?? c.json({ error: 'not found' }, 404);
      })
  );
}

export const settings = createSettingsRoutes();
