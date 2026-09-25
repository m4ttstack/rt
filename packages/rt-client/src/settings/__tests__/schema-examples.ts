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
    good: [{}, { autoResolve: [{ glob: "pnpm-lock.yaml", strategy: "theirs", postResolve: ["pnpm install"] }, { glob: ["**/generated/**", "**/*.snap"], strategy: "ours" }] }, { autoResolve: [{ glob: "**/*.snap" }] }],
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
  "rt.mcp.uploadRoots": { good: [[], ["/Users/me/Screenshots"]], bad: [{ value: ["/a", 7], path: [1] }] },
  "rt.integrations": {
    good: [{}, { forgeHost: "gitlab.example.com", switchboardUrl: "https://switchboard.example.com" }],
    bad: [{ value: { forgeHost: 443 }, path: ["forgeHost"] }],
    layer: [{ switchboardUrl: "https://switchboard.example.com" }],
  },
  "mattstack.integrations": {
    good: [
      {},
      { forge: null },
      {
        forge: { host: "gitlab.example.com", provider: "gitlab" },
        linear: { teamKey: "ACME" },
        slack: { appId: "A0123", clientId: "123.456", channel: "#acme-dev", callbackPort: 53682 },
        switchboard: { url: "https://switchboard.example.com" },
      },
      { linear: {} },
    ],
    bad: [
      { value: { forge: { host: "gitlab.example.com", provider: "bitbucket" } }, path: ["forge", "provider"] },
      { value: { slack: { callbackPort: "53682" } }, path: ["slack", "callbackPort"] },
    ],
    layer: [{ forge: { host: "gitlab.example.com" } }, { slack: { channel: "#acme-dev" } }],
  },
  "mattstack.tracking": {
    good: [{}, { repos: {} }, { repos: { "gitlab.example.com/acme/app": { caches: ["branches", "project-mrs"] }, "gitlab.example.com/acme/docs": {} } }],
    bad: [
      { value: { repos: ["gitlab.example.com/acme/app"] }, path: ["repos"] },
      { value: { repos: { "gitlab.example.com/acme/app": { caches: "branches" } } }, path: ["repos", "gitlab.example.com/acme/app", "caches"] },
    ],
    layer: [{ repos: { "gitlab.example.com/acme/app": { caches: ["discussions"] } } }],
  },
  "setup.waived": { good: [[], ["tool.fast-browser-extension"]], bad: [{ value: [true], path: [0] }] },
  "mattstack.roster": {
    good: [[], [{ username: "dev1" }, { username: "dev2", name: "Dev Two", agePublicKey: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" }]],
    bad: [
      { value: [{ name: "Dev One" }], path: [0, "username"] },
      { value: ["dev1"], path: [0] },
    ],
  },
  "claude.marketplaces": { good: [[], ["acme/claude-plugins", "https://gitlab.example.com/acme/marketplace.git"]], bad: [{ value: [{ source: "acme/claude-plugins" }], path: [0] }] },
  "claude.plugins": { good: [[], ["review@acme", "deploy@acme"]], bad: [{ value: ["review@acme", 2], path: [1] }] },
  "deck.apps": {
    good: [{}, { app: { published: true, publicFollowsOverride: false } }, { docs: { published: false, passwordVersion: 2, override: { devPort: 5174, basePort: 4100 } } }],
    bad: [
      { value: { app: { published: "yes" } }, path: ["app", "published"] },
      { value: { app: { override: { devPort: 5174 } } }, path: ["app", "override", "basePort"] },
    ],
    layer: [{ app: { published: false } }, { app: { override: { devPort: 5175 } } }],
  },
  "deck.access": {
    good: [{}, { app: { mode: "off" }, docs: { mode: "emails", emails: ["dev@example.com"] }, admin: { mode: "domains", domains: ["example.com"] } }],
    bad: [
      { value: { app: "off" }, path: ["app"] },
      { value: { app: { mode: "sso" } }, path: ["app", "mode"] },
    ],
    layer: [{ docs: { emails: ["dev@example.com", "ops@example.com"] } }],
  },
  "deck.platform": {
    good: [
      {},
      { publicDomain: null, legacyPrefixes: [], railway: null, tunnel: null },
      { publicDomain: "apps.example.com", legacyPrefixes: ["old"], tunnel: { name: "deck", uuid: "00000000-0000-4000-8000-000000000000" }, railway: { projectId: "p1", environmentId: "e1" } },
    ],
    bad: [
      { value: { publicDomain: 7 }, path: ["publicDomain"] },
      { value: { tunnel: { name: "deck" } }, path: ["tunnel", "uuid"] },
    ],
    layer: [{ publicDomain: "apps.example.com" }, { tunnel: { uuid: "00000000-0000-4000-8000-000000000000" } }],
  },
  "board.projects": { good: [[], ["acme/app", "acme/docs"]], bad: [{ value: [{ path: "acme/app" }], path: [0] }] },
  "board.members": {
    good: [[], [{ username: "dev1" }, { username: "dev2", name: "Dev Two", hidden: true }]],
    bad: [
      { value: [{ name: "Dev One" }], path: [0, "username"] },
      { value: [{ username: "dev1", hidden: "yes" }], path: [0, "hidden"] },
    ],
  },
  "board.botUsernames": { good: [[], ["release-bot"]], bad: [{ value: [false], path: [0] }] },
  "board.ticketPrefixes": { good: [[], ["ACME", "OPS"]], bad: [{ value: "ACME", path: [] }] },
  "board.slack": {
    good: [
      {},
      {
        channel: "acme-review",
        singleTemplate: "{title}: {url}",
        multiHeader: "{count} MRs ready for review",
        multiItem: "- {title}: {url}",
        autoResolveIntervalMinutes: 15,
        emoji: { looking: "eyes", commented: "speech_balloon", approved: "white_check_mark" },
      },
    ],
    bad: [
      { value: { autoResolveIntervalMinutes: "15" }, path: ["autoResolveIntervalMinutes"] },
      { value: { emoji: { looking: 1 } }, path: ["emoji", "looking"] },
    ],
    layer: [{ emoji: { approved: "tada" } }],
  },
  "board.tabs": {
    good: [
      [],
      [
        { id: "team", label: "Team", source: { kind: "authors" } },
        { id: "platform", label: "Platform", source: { kind: "codeowners", section: "Platform", excludeMembers: true }, slackChannel: "acme-platform", reviewSkill: "review" },
      ],
    ],
    bad: [
      { value: [{ id: "team", source: { kind: "authors" } }], path: [0, "label"] },
      { value: [{ id: "team", label: "Team", source: { kind: "authors" }, slackChannel: 7 }], path: [0, "slackChannel"] },
    ],
  },
  "board.workspaces": {
    good: [{}, { reviews: "reviews", responds: "responses", doctors: "doctors" }],
    bad: [{ value: { reviews: 1 }, path: ["reviews"] }],
    layer: [{ doctors: "doctors" }],
  },
  "board.hiddenMembers": { good: [[], ["dev2"]], bad: [{ value: [{ username: "dev2" }], path: [0] }] },
  "board.triage": {
    good: [
      {},
      {
        enabled: true,
        cooldownMinutes: 30,
        dailyAttemptBudget: 3,
        notify: "badge-only",
        tier: "checkout",
        fixClasses: { retryFlake: true, inheritedNoteDraft: true, cleanApiRebase: false, mechanicalLint: false, codeFix: false },
      },
    ],
    bad: [
      { value: { tier: "full" }, path: ["tier"] },
      { value: { fixClasses: { codeFix: "on" } }, path: ["fixClasses", "codeFix"] },
    ],
    layer: [{ fixClasses: { retryFlake: false } }],
  },
  "board.reReview": {
    good: [{}, { enabled: false }],
    bad: [{ value: { enabled: "no" }, path: ["enabled"] }],
    layer: [{ enabled: true }],
  },
  "board.cwds": {
    good: [{}, { review: "/Users/dev/src/app", respond: "", doctor: "/Users/dev/src/app" }],
    bad: [{ value: { review: ["/Users/dev/src/app"] }, path: ["review"] }],
    layer: [{ respond: "/Users/dev/src/app" }],
  },
  "boxscore.projects": { good: [[], ["acme/app"]], bad: [{ value: [7], path: [0] }] },
  "boxscore.linearDoneStates": { good: [[], ["Done", "Released"]], bad: [{ value: [null], path: [0] }] },
  "boxscore.sizeBand": {
    good: [{}, { tooSmall: 10, tooLarge: 400 }],
    bad: [{ value: { tooLarge: "400" }, path: ["tooLarge"] }],
    layer: [{ tooSmall: 5 }],
  },
  "boxscore.excludeFilePatterns": { good: [[], ["**/*.json", "**/generated/**"]], bad: [{ value: [true], path: [0] }] },
  "boxscore.ignoredMrs": { good: [[], ["!123", "acme/app!456"]], bad: [{ value: [123], path: [0] }] },
  "boxscore.botPatterns": { good: [[], ["^renovate", "-bot$"]], bad: [{ value: [{ pattern: "-bot$" }], path: [0] }] },
  "boxscore.hiddenMembers": { good: [[], ["dev2"]], bad: [{ value: [2], path: [0] }] },
  "gitq.workSlots": {
    good: [{}, { workSlotLocation: "/Users/dev/.gitq-slots", maxWorkSlots: 3 }],
    bad: [{ value: { maxWorkSlots: "3" }, path: ["maxWorkSlots"] }],
    layer: [{ maxWorkSlots: 5 }],
  },
  "gitq.forges": {
    good: [{}, { "gitlab.example.com": { provider: "gitlab", tokenEnv: "ACME_GITLAB_TOKEN" }, work: { provider: "github", baseUrl: "https://github.example.com" } }],
    bad: [
      { value: { "gitlab.example.com": { provider: "bitbucket" } }, path: ["gitlab.example.com", "provider"] },
      { value: { "gitlab.example.com": { tokenEnv: "ACME_GITLAB_TOKEN" } }, path: ["gitlab.example.com", "provider"] },
    ],
    layer: [{ "gitlab.example.com": { tokenEnv: "ACME_GITLAB_TOKEN" } }],
  },
  "gitq.board": {
    good: [
      { repos: [] },
      { repos: ["app"], port: 11008 },
      { repos: [{ path: "/Users/dev/src/app", name: "app" }, { path: "/Users/dev/src/docs" }], port: 11008, herdrWorkspace: "gitq" },
    ],
    bad: [
      { value: { port: 11008 }, path: ["repos"] },
      { value: { repos: [{ name: "app" }] }, path: ["repos", 0] },
    ],
    layer: [{ port: 11009 }],
  },
};
