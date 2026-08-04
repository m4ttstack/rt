/**
 * Demo app — simulates an external consumer of @mattstack/glance-react.
 *
 * All imports use the package name, not relative paths to lib/.
 * vite.app.config.ts aliases these to dist/ or lib/ based on mode:
 *
 *   bun run dev:app        → imports from lib/ source (local dev)
 *   bun run dev:app:dist   → imports from dist/ (simulates npm consumer)
 */
import '@mattstack/glance-react/styles.css';

import {
  Badge,
  Button,
  GitHubIcon,
  GitLabIcon,
  IconButton,
  MRStatusBadge,
  Switch,
} from '@mattstack/glance-react';
import type { MRStatus } from '@mattstack/glance-react';

const statuses: MRStatus[] = [
  'mergeable',
  'blocked',
  'draft',
  'closed',
  'merged',
];

function App() {
  return (
    <div
      style={{
        minHeight: '100vh',
        padding: '2rem',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
      className="bg-background text-foreground"
    >
      <h1 className="text-xl font-bold mb-6">
        @mattstack/glance-react — Consumer Demo
      </h1>

      {/* ── Primitives ────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Button Variants</h2>
        <p className="text-xs text-muted-foreground mb-2">filled (default)</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <Button color="emphasis">Emphasis</Button>
          <Button color="merge">Merge</Button>
          <Button color="action">Action</Button>
          <Button color="positive">Positive</Button>
          <Button color="negative">Negative</Button>
          <Button color="caution">Caution</Button>
          <Button variant="filled" color="neutral">Neutral</Button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">outline</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <Button variant="outline" color="emphasis">Emphasis</Button>
          <Button variant="outline" color="action">Action</Button>
          <Button variant="outline" color="positive">Positive</Button>
          <Button variant="outline" color="negative">Negative</Button>
          <Button variant="outline" color="caution">Caution</Button>
          <Button variant="outline" color="neutral">Neutral</Button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">subtle</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <Button variant="subtle" color="emphasis">Emphasis</Button>
          <Button variant="subtle" color="action">Action</Button>
          <Button variant="subtle" color="positive">Positive</Button>
          <Button variant="subtle" color="negative">Negative</Button>
          <Button variant="subtle" color="caution">Caution</Button>
          <Button variant="subtle" color="neutral">Neutral</Button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">ghost</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <Button variant="ghost" color="emphasis">Emphasis</Button>
          <Button variant="ghost" color="action">Action</Button>
          <Button variant="ghost" color="positive">Positive</Button>
          <Button variant="ghost" color="negative">Negative</Button>
          <Button variant="ghost" color="caution">Caution</Button>
          <Button variant="ghost" color="neutral">Neutral</Button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">link</p>
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="link" color="emphasis">Emphasis</Button>
          <Button variant="link" color="action">Action</Button>
          <Button variant="link" color="positive">Positive</Button>
          <Button variant="link" color="negative">Negative</Button>
          <Button variant="link" color="caution">Caution</Button>
          <Button variant="link" color="neutral">Neutral</Button>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Button Sizes — Standard vs Compact</h2>
        <p className="text-xs text-muted-foreground mb-2">standard sizes (xs → lg)</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <Button size="xs">XS</Button>
          <Button size="sm">SM</Button>
          <Button size="default">Default</Button>
          <Button size="lg">LG</Button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">compact sizes (compact-xs → compact-lg)</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <Button size="compact-xs">Compact XS</Button>
          <Button size="compact-sm">Compact SM</Button>
          <Button size="compact-md">Compact MD</Button>
          <Button size="compact-lg">Compact LG</Button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">compact outline</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <Button variant="outline" color="neutral" size="compact-xs">Compact XS</Button>
          <Button variant="outline" color="neutral" size="compact-sm">Compact SM</Button>
          <Button variant="outline" color="neutral" size="compact-md">Compact MD</Button>
          <Button variant="outline" color="neutral" size="compact-lg">Compact LG</Button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">compact subtle</p>
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="subtle" color="emphasis" size="compact-xs">Compact XS</Button>
          <Button variant="subtle" color="emphasis" size="compact-sm">Compact SM</Button>
          <Button variant="subtle" color="emphasis" size="compact-md">Compact MD</Button>
          <Button variant="subtle" color="emphasis" size="compact-lg">Compact LG</Button>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Icon Buttons</h2>
        <p className="text-xs text-muted-foreground mb-2">ghost (default)</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <IconButton aria-label="GitLab" size="xs"><GitLabIcon className="size-3" /></IconButton>
          <IconButton aria-label="GitLab" size="sm"><GitLabIcon className="size-4" /></IconButton>
          <IconButton aria-label="GitLab"><GitLabIcon className="size-5" /></IconButton>
          <IconButton aria-label="GitLab" size="lg"><GitLabIcon className="size-5" /></IconButton>
          <span className="text-xs text-muted-foreground mx-2">│</span>
          <IconButton aria-label="GitHub" size="xs"><GitHubIcon className="size-3" /></IconButton>
          <IconButton aria-label="GitHub" size="sm"><GitHubIcon className="size-4" /></IconButton>
          <IconButton aria-label="GitHub"><GitHubIcon className="size-5" /></IconButton>
          <IconButton aria-label="GitHub" size="lg"><GitHubIcon className="size-5" /></IconButton>
        </div>
        <p className="text-xs text-muted-foreground mb-2">outline</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <IconButton variant="outline" aria-label="GitLab" size="xs"><GitLabIcon className="size-3" /></IconButton>
          <IconButton variant="outline" aria-label="GitLab" size="sm"><GitLabIcon className="size-4" /></IconButton>
          <IconButton variant="outline" aria-label="GitLab"><GitLabIcon className="size-5" /></IconButton>
          <IconButton variant="outline" aria-label="GitLab" size="lg"><GitLabIcon className="size-5" /></IconButton>
          <span className="text-xs text-muted-foreground mx-2">│</span>
          <IconButton variant="outline" aria-label="GitHub" size="xs"><GitHubIcon className="size-3" /></IconButton>
          <IconButton variant="outline" aria-label="GitHub" size="sm"><GitHubIcon className="size-4" /></IconButton>
          <IconButton variant="outline" aria-label="GitHub"><GitHubIcon className="size-5" /></IconButton>
          <IconButton variant="outline" aria-label="GitHub" size="lg"><GitHubIcon className="size-5" /></IconButton>
        </div>
        <p className="text-xs text-muted-foreground mb-2">subtle</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <IconButton variant="subtle" aria-label="GitLab" size="xs"><GitLabIcon className="size-3" /></IconButton>
          <IconButton variant="subtle" aria-label="GitLab" size="sm"><GitLabIcon className="size-4" /></IconButton>
          <IconButton variant="subtle" aria-label="GitLab"><GitLabIcon className="size-5" /></IconButton>
          <IconButton variant="subtle" aria-label="GitLab" size="lg"><GitLabIcon className="size-5" /></IconButton>
          <span className="text-xs text-muted-foreground mx-2">│</span>
          <IconButton variant="subtle" aria-label="GitHub" size="xs"><GitHubIcon className="size-3" /></IconButton>
          <IconButton variant="subtle" aria-label="GitHub" size="sm"><GitHubIcon className="size-4" /></IconButton>
          <IconButton variant="subtle" aria-label="GitHub"><GitHubIcon className="size-5" /></IconButton>
          <IconButton variant="subtle" aria-label="GitHub" size="lg"><GitHubIcon className="size-5" /></IconButton>
        </div>
        <p className="text-xs text-muted-foreground mb-2">filled</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <IconButton variant="filled" aria-label="GitLab" size="xs"><GitLabIcon className="size-3" /></IconButton>
          <IconButton variant="filled" aria-label="GitLab" size="sm"><GitLabIcon className="size-4" /></IconButton>
          <IconButton variant="filled" aria-label="GitLab"><GitLabIcon className="size-5" /></IconButton>
          <IconButton variant="filled" aria-label="GitLab" size="lg"><GitLabIcon className="size-5" /></IconButton>
          <span className="text-xs text-muted-foreground mx-2">│</span>
          <IconButton variant="filled" aria-label="GitHub" size="xs"><GitHubIcon className="size-3" /></IconButton>
          <IconButton variant="filled" aria-label="GitHub" size="sm"><GitHubIcon className="size-4" /></IconButton>
          <IconButton variant="filled" aria-label="GitHub"><GitHubIcon className="size-5" /></IconButton>
          <IconButton variant="filled" aria-label="GitHub" size="lg"><GitHubIcon className="size-5" /></IconButton>
        </div>
        <p className="text-xs text-muted-foreground mb-2">compact ghost</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <IconButton aria-label="GitLab" size="compact-xs"><GitLabIcon className="size-3" /></IconButton>
          <IconButton aria-label="GitLab" size="compact-sm"><GitLabIcon className="size-3.5" /></IconButton>
          <IconButton aria-label="GitLab" size="compact-md"><GitLabIcon className="size-4" /></IconButton>
          <IconButton aria-label="GitLab" size="compact-lg"><GitLabIcon className="size-4" /></IconButton>
        </div>
        <p className="text-xs text-muted-foreground mb-2">compact outline</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <IconButton variant="outline" aria-label="GitLab" size="compact-xs"><GitLabIcon className="size-3" /></IconButton>
          <IconButton variant="outline" aria-label="GitLab" size="compact-sm"><GitLabIcon className="size-3.5" /></IconButton>
          <IconButton variant="outline" aria-label="GitLab" size="compact-md"><GitLabIcon className="size-4" /></IconButton>
          <IconButton variant="outline" aria-label="GitLab" size="compact-lg"><GitLabIcon className="size-4" /></IconButton>
        </div>
        <p className="text-xs text-muted-foreground mb-2">compact filled</p>
        <div className="flex flex-wrap gap-2 items-center">
          <IconButton variant="filled" aria-label="GitLab" size="compact-xs"><GitLabIcon className="size-3" /></IconButton>
          <IconButton variant="filled" aria-label="GitLab" size="compact-sm"><GitLabIcon className="size-3.5" /></IconButton>
          <IconButton variant="filled" aria-label="GitLab" size="compact-md"><GitLabIcon className="size-4" /></IconButton>
          <IconButton variant="filled" aria-label="GitLab" size="compact-lg"><GitLabIcon className="size-4" /></IconButton>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Badge Variants</h2>
        <p className="text-xs text-muted-foreground mb-2">filled</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <Badge color="emphasis">emphasis</Badge>
          <Badge color="merge">merge</Badge>
          <Badge color="positive">positive</Badge>
          <Badge color="negative">negative</Badge>
          <Badge color="caution">caution</Badge>
          <Badge color="action">action</Badge>
          <Badge color="neutral">neutral</Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-2">subtle</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <Badge variant="subtle" color="positive">positive</Badge>
          <Badge variant="subtle" color="negative">negative</Badge>
          <Badge variant="subtle" color="caution">caution</Badge>
          <Badge variant="subtle" color="emphasis">emphasis</Badge>
          <Badge variant="subtle" color="action">action</Badge>
          <Badge variant="subtle" color="neutral">neutral</Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-2">outline</p>
        <div className="flex flex-wrap gap-2 items-center">
          <Badge variant="outline" color="positive">positive</Badge>
          <Badge variant="outline" color="negative">negative</Badge>
          <Badge variant="outline" color="caution">caution</Badge>
          <Badge variant="outline" color="emphasis">emphasis</Badge>
          <Badge variant="outline" color="neutral">neutral</Badge>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Switch</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm">Toggle:</label>
          <Switch />
        </div>
      </section>

      {/* ── Domain Components ─────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">MRStatusBadge</h2>
        <div className="flex flex-wrap gap-2">
          {statuses.map(s => (
            <MRStatusBadge key={s} status={s} />
          ))}
        </div>
      </section>

      {/* ── GDS Token Validation ──────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">
          GDS Token Validation (consumer markup using library tokens)
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <span className="text-card-foreground text-sm">Card token</span>
          </div>
          <div className="rounded-lg bg-positive/25 p-3">
            <span className="text-positive-bright text-sm">Positive token</span>
          </div>
          <div className="rounded-lg bg-negative/25 p-3">
            <span className="text-negative-bright text-sm">Negative token</span>
          </div>
          <div className="rounded-lg bg-caution/25 p-3">
            <span className="text-caution-bright text-sm">Caution token</span>
          </div>
          <div className="rounded-lg bg-action/25 p-3">
            <span className="text-action-bright text-sm">Action token</span>
          </div>
          <div className="rounded-lg bg-emphasis/25 p-3">
            <span className="text-emphasis-bright text-sm">Emphasis token</span>
          </div>
        </div>
      </section>

      {/* ── Theme Toggle ──────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Theme Toggle</h2>
        <p className="text-sm text-muted-foreground mb-2">
          Toggles the .dark class on &lt;html&gt; (industry standard):
        </p>
        <Button
          variant="outline"
          color="neutral"
          onClick={() => {
            document.documentElement.classList.toggle('dark');
          }}
        >
          Toggle Light / Dark
        </Button>
      </section>
    </div>
  );
}

export default App;
