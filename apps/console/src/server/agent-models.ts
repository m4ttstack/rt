import { Hono } from 'hono';

export interface AgentModelOption {
  value: string;
  label: string;
}

// No live catalog command exists for claude (verified: no model-list
// subcommand in `claude --help`). Maintained by hand; a stale entry here is
// a documentation debt, not a correctness bug -- these are suggestions, not
// validated choices.
const CLAUDE_MODELS: AgentModelOption[] = [
  { value: 'sonnet', label: 'Sonnet (latest)' },
  { value: 'opus', label: 'Opus (latest)' },
  { value: 'haiku', label: 'Haiku (latest)' },
  { value: 'fable', label: 'Fable (latest)' },
];

interface CodexCatalogModel {
  slug: string;
  display_name: string;
  visibility: string;
}

/** `codex debug models` returns the real, live catalog -- confirmed against
    the installed codex-cli 0.153.4. Filtered to visibility: "list" (the
    user-facing set; "hide" entries are internal/experimental). */
// A hung `codex` binary must not hold the HTTP request (or the child
// process) open forever; Bun kills the process once `timeout` elapses.
const CODEX_MODELS_TIMEOUT_MS = 5000;

async function codexModels(): Promise<AgentModelOption[]> {
  const proc = Bun.spawn(['codex', 'debug', 'models'], {
    stdout: 'pipe',
    stderr: 'ignore',
    timeout: CODEX_MODELS_TIMEOUT_MS,
  });
  try {
    const [text, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) return [];
    const parsed = JSON.parse(text) as { models: CodexCatalogModel[] };
    return parsed.models
      .filter(m => m.visibility === 'list')
      .map(m => ({ value: m.slug, label: m.display_name }));
  } finally {
    proc.kill();
  }
}

export const agentModels = new Hono().get('/api/agent/models', async c => {
  const provider = c.req.query('provider');
  if (provider === 'claude') return c.json({ models: CLAUDE_MODELS }, 200);
  if (provider === 'codex') {
    try {
      return c.json({ models: await codexModels() }, 200);
    } catch {
      // codex not installed / catalog shape changed: an empty list degrades
      // to free-text entry in the UI rather than a broken page.
      return c.json({ models: [] }, 200);
    }
  }
  return c.json({ error: 'provider must be "claude" or "codex"' }, 400);
});
