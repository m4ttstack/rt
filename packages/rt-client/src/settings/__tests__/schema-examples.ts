export interface Example { good: unknown[]; bad: { value: unknown; path: (string | number)[] }[]; layer?: unknown[] }

const TRACKED = "remote:gitlab.example.com%2Facme%2Fapp";

export const EXAMPLES: Record<string, Example> = {
  "rt.roles": {
    good: [
      {},
      {
        backend: { pool: [4000, { from: 4100, to: 4110 }], needs: [], preserveEnv: ["DATABASE_*"], env: { PORT: "${port}" }, hook: "./scripts/dev-hook.sh" },
        frontend: { fixedPort: 3000, needs: ["backend"], env: { API_URL: "http://localhost:${roles.backend.port}" } },
      },
    ],
    bad: [
      { value: { backend: { pool: ["4000"] } }, path: ["backend", "pool", 0] },
      { value: { backend: { env: { PORT: 4000 } } }, path: ["backend", "env", "PORT"] },
    ],
    layer: [{ backend: { hook: "./scripts/dev-hook.sh" } }],
  },
  "rt.intercepts": {
    good: [
      [],
      [{
        command: "pnpm",
        matches: [
          { cwdGlob: "**/apps/backend", role: "backend", argPattern: "^dev$" },
          { cwdGlob: "**/apps/frontend", role: "frontend", argInject: { afterArg: "dev", template: "--port ${port}", skipIfArgPresent: "--port" } },
        ],
      }],
    ],
    bad: [
      { value: [{ command: "pnpm", matches: [{ cwdGlob: "**/apps/backend" }] }], path: [0, "matches", 0, "role"] },
      { value: [{ command: "pnpm" }], path: [0, "matches"] },
    ],
  },
  "rt.worktrees": {
    good: [
      {},
      { onDeck: 0 },
      {
        onDeck: 2,
        ready: [{ run: "pnpm install", when: "changed:pnpm-lock.yaml" }, { run: "pnpm build" }],
        namePool: ["bilbo", "frodo"],
        root: "${repoRoot}/../trees",
        branchFormat: "<ticket>-<slug>",
        staleClaimDays: 7,
        junk: ["**/dist/**"],
      },
    ],
    bad: [
      { value: { onDeck: "2" }, path: ["onDeck"] },
      { value: { ready: [{ when: "changed:pnpm-lock.yaml" }] }, path: ["ready", 0, "run"] },
    ],
    layer: [{ namePool: ["bilbo"] }],
  },
  "rt.ignoredMrs": {
    good: [{}, { targetBranches: ["deployments/*"], authors: ["release-bot"] }],
    bad: [{ value: { targetBranches: "deployments/*" }, path: ["targetBranches"] }],
    layer: [{ authors: ["release-bot"] }],
  },
  "rt.repoIdentityOverrides": {
    good: [{}, { "git@gitlab.example.com:acme/app.git": "gitlab.example.com/acme/app" }],
    bad: [{ value: { "git@gitlab.example.com:acme/app.git": 1 }, path: ["git@gitlab.example.com:acme/app.git"] }],
  },
  "rt.repoRoots": { good: [[], ["~/Documents/GitHub"]], bad: [{ value: [1], path: [0] }] },
  "rt.notifications": {
    good: [{}, { pipeline_failed: false, chat_mention: true }],
    bad: [{ value: { pipeline_failed: "off" }, path: ["pipeline_failed"] }],
    layer: [{ mr_merged: false }],
  },
  "rt.notify.eventBridges": {
    good: [
      [],
      [{ pattern: "gate/opened/*", category: "gate", title: "{label}", message: "{question}", url: "https://console.example/gates/{id}", owner: "human", subjectPrefix: "run:" }],
      [{ pattern: "herd/gates-waiting/*", category: "herd-watchdog", title: "{headline}", message: "{summary}", surface: "board" }],
    ],
    bad: [
      { value: [{ pattern: 1, category: "gate", title: "t", message: "m" }], path: [0, "pattern"] },
      { value: [{ pattern: "x", category: "gate", title: "t", message: "m", owner: "herd" }], path: [0, "owner"] },
    ],
  },
  "rt.cron": {
    good: [
      {},
      { triggers: [] },
      { triggers: [{ name: "board-triage", event: "project-mrs", run: ["bun", "run", "triage"], debounceMs: 5000 }, { name: "sync", event: "branches", repoName: "app", run: ["rt", "sync"] }] },
    ],
    bad: [
      { value: { triggers: [{ name: "board-triage", event: "project-mrs" }] }, path: ["triggers", 0, "run"] },
      { value: { triggers: [{ name: "board-triage", event: "project-mrs", run: ["rt"], debounceMs: "5000" }] }, path: ["triggers", 0, "debounceMs"] },
    ],
    layer: [{ triggers: [{ name: "board-triage", event: "project-mrs", run: ["rt"] }] }],
  },
  "rt.repoTracking": {
    good: [
      {},
      { [TRACKED]: { mode: "live", caches: ["branches", "project-mrs"], projectMrsWindowDays: 14 } },
      { [TRACKED]: { mode: "off" } },
      { [TRACKED]: "poll" },
    ],
    bad: [{ value: { [TRACKED]: 1 }, path: [TRACKED] }],
    layer: [{ [TRACKED]: { mode: "poll" } }],
  },
  "rt.runaway": {
    good: [{}, { cpuThreshold: 90, sustainMs: 600000, graceMs: 120000 }],
    bad: [{ value: { cpuThreshold: "90" }, path: ["cpuThreshold"] }],
    layer: [{ cpuThreshold: 95 }],
  },
  "rt.workspacePrefs": {
    good: [{}, { editors: { app: "zed" }, workspaces: { "/Users/dev/app": "/Users/dev/app/app.code-workspace" }, defaultEditor: "cursor" }],
    bad: [{ value: { editors: { app: 1 } }, path: ["editors", "app"] }],
    layer: [{ defaultEditor: "zed" }],
  },
  "rt.homeSnapshot": {
    good: [{ enabled: true, debounceSec: 20, pushDelaySec: 60, janitorThresholdHours: 6, janitorIntervalMin: 30 }],
    bad: [{ value: { enabled: "yes", debounceSec: 20, pushDelaySec: 60, janitorThresholdHours: 6, janitorIntervalMin: 30 }, path: ["enabled"] }],
    layer: [{ enabled: false }, { debounceSec: 5 }],
  },
  "rt.teamSnapshot": {
    good: [{ enabled: true, debounceSec: 20, pushDelaySec: 60, janitorThresholdHours: 6, janitorIntervalMin: 30, pullIntervalSec: 300 }],
    bad: [{ value: { enabled: true, debounceSec: 20, pushDelaySec: 60, janitorThresholdHours: 6, janitorIntervalMin: 30, pullIntervalSec: "300" }, path: ["pullIntervalSec"] }],
    layer: [{ pullIntervalSec: 120 }],
  },
  "rt.sync": {
    good: [{}, { autoResolve: [{ glob: "pnpm-lock.yaml", strategy: "theirs", postResolve: ["pnpm install"] }, { glob: ["**/generated/**", "**/*.snap"], strategy: "ours" }] }],
    bad: [
      { value: { autoResolve: [{ glob: "pnpm-lock.yaml", strategy: "mine" }] }, path: ["autoResolve", 0, "strategy"] },
      { value: { autoResolve: [{ strategy: "theirs" }] }, path: ["autoResolve", 0, "glob"] },
    ],
    layer: [{ autoResolve: [{ glob: "pnpm-lock.yaml", strategy: "theirs" }] }],
  },
  "rt.branchNaming": {
    good: [{}, { template: "${identifier}-${titleSlug}" }],
    bad: [{ value: { template: 1 }, path: ["template"] }],
    layer: [{ template: "${teamPrefix}/${ticketNumber}-${llmSlug:4}" }],
  },
  "rt.variations": {
    good: [{}, { ".:dev": [{ name: "staging", command: "pnpm dev --mode staging" }], "apps/backend:test": [] }],
    bad: [{ value: { ".:dev": [{ name: "staging" }] }, path: [".:dev", 0, "command"] }],
    layer: [{ "apps/backend:test": [{ name: "watch", command: "pnpm test --watch" }] }],
  },
  "rt.presets": {
    good: [{}, { daily: { entries: [{ packageRelPath: "apps/backend", packageLabel: "backend", script: "dev" }, { packageRelPath: ".", packageLabel: "root", script: "dev", variationName: "staging", command: "pnpm dev --mode staging" }] } }],
    bad: [
      { value: { daily: {} }, path: ["daily", "entries"] },
      { value: { daily: { entries: [{ packageRelPath: "apps/backend", packageLabel: "backend" }] } }, path: ["daily", "entries", 0, "script"] },
    ],
    layer: [{ daily: { entries: [] } }],
  },
  "rt.dopplerTemplate": {
    good: [[], [{ path: "apps/backend", project: "backend", config: "dev" }, { path: "apps/frontend", project: "frontend", config: "dev" }]],
    bad: [{ value: [{ path: "apps/backend", project: "backend" }], path: [0, "config"] }],
  },
  "rt.worktreeApp": {
    good: [{}, { enabled: true, killProcesses: false }, { enabled: false, killProcesses: true, claudeHook: "declined" }],
    bad: [{ value: { enabled: "true" }, path: ["enabled"] }],
    layer: [{ killProcesses: false }],
  },
  "rt.sdmEnrichment": {
    good: [{}, { "acme-staging-db": { label: "Staging DB", tier: "staging", production: false, reasonSuggestion: "debugging", db: { database: "app", schema: "public", user: "readonly" } } }],
    bad: [{ value: { "acme-staging-db": { production: "no" } }, path: ["acme-staging-db", "production"] }],
  },
  "rt.gitStatus": {
    good: [{ sweep: true, sweepIntervalSec: 300, fetchIntervalSec: 900 }],
    bad: [{ value: { sweep: true, sweepIntervalSec: "300", fetchIntervalSec: 900 }, path: ["sweepIntervalSec"] }],
    layer: [{ sweep: false }],
  },
  "rt.hooks": {
    good: [{}, { enabled: true, hooks: { "pre-commit": false, "pre-push": true } }],
    bad: [{ value: { hooks: { "pre-commit": "off" } }, path: ["hooks", "pre-commit"] }],
    layer: [{ hooks: { "pre-push": false } }],
  },
  "rt.trustedBrowserOrigins": { good: [[], ["http://localhost:5173"]], bad: [{ value: [5173], path: [0] }] },
  "rt.integrations": {
    good: [{}, { forgeHost: "gitlab.example.com", switchboardUrl: "https://switchboard.example.com" }],
    bad: [{ value: { forgeHost: 443 }, path: ["forgeHost"] }],
    layer: [{ switchboardUrl: "https://switchboard.example.com" }],
  },
};
