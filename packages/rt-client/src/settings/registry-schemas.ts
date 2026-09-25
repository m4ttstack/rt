/**
 * One zod schema per composite settings key: the value a reader receives.
 * Authoring only: the lock file generated from this is what runs. Objects
 * are loose unless a reader rejects unknown properties. Display metadata
 * (labels, placeholders) rides on .meta() into the JSON Schema.
 */

import { z } from "zod";
import { NOTIFICATION_EVENT_KEYS } from "./notification-events.ts";

const snapshot = { enabled: z.boolean(), debounceSec: z.number(), pushDelaySec: z.number(), janitorThresholdHours: z.number(), janitorIntervalMin: z.number() };

const stringMap = z.record(z.string(), z.string());

const role = z.looseObject({
  pool: z.array(z.union([z.number(), z.looseObject({ from: z.number(), to: z.number() })])).optional(),
  fixedPort: z.number().optional(),
  needs: z.array(z.string()).optional(),
  preserveEnv: z.array(z.string()).optional(),
  env: stringMap.optional(),
  hook: z.string().optional(),
});

const interceptMatch = z.looseObject({
  cwdGlob: z.string(),
  role: z.string(),
  argPattern: z.string().optional(),
  argInject: z.looseObject({ afterArg: z.string(), template: z.string(), skipIfArgPresent: z.string() }).optional(),
});

const cronTrigger = z.looseObject({
  name: z.string().min(1),
  event: z.string().min(1),
  run: z.array(z.string()).min(1),
  repoName: z.string().optional(),
  debounceMs: z.number().positive().optional(),
});

// Any mode string names its repo: a mode other than live/poll is the local
// opt-out that blocks team-declared tracking, and unknown cache names are dropped.
const trackingEntry = z.union([
  z.string(),
  z.looseObject({
    mode: z.string(),
    caches: z.array(z.string()).optional(),
    projectMrsWindowDays: z.number().optional(),
  }),
]);

const presetEntry = z.looseObject({
  packageRelPath: z.string(),
  packageLabel: z.string(),
  script: z.string(),
  variationName: z.string().optional(),
  command: z.string().optional(),
});

export const SCHEMAS = {
  "rt.roles": z.record(z.string(), role),
  "rt.intercepts": z.array(z.looseObject({ command: z.string().min(1), matches: z.array(interceptMatch) })),
  "rt.worktrees": z.looseObject({
    onDeck: z.number().optional(),
    ready: z.array(z.looseObject({ run: z.string(), when: z.string().optional() })).optional(),
    namePool: z.array(z.string()).optional(),
    root: z.string().optional(),
    branchFormat: z.string().optional(),
    staleClaimDays: z.number().optional(),
    junk: z.array(z.string()).optional(),
  }),
  "rt.ignoredMrs": z.looseObject({ targetBranches: z.array(z.string()).optional(), authors: z.array(z.string()).optional() }),
  "rt.repoIdentityOverrides": stringMap.meta({ labels: { key: "remote URL", value: "identity" } }),
  "rt.repoRoots": z.array(z.string()),
  "rt.notifications": z.looseObject(Object.fromEntries(NOTIFICATION_EVENT_KEYS.map((k) => [k, z.boolean().optional()]))),
  "rt.notify.eventBridges": z.array(
    z.looseObject({
      pattern: z.string(),
      category: z.string(),
      title: z.string(),
      message: z.string(),
      subjectPrefix: z.string().optional(),
      url: z.string().optional(),
      owner: z.literal("human").optional(),
      surface: z.string().optional(),
    }),
  ),
  "rt.cron": z.looseObject({ triggers: z.array(cronTrigger).optional() }),
  "rt.repoTracking": z.record(z.string(), trackingEntry),
  "rt.runaway": z.looseObject({ cpuThreshold: z.number().optional(), sustainMs: z.number().optional(), graceMs: z.number().optional() }),
  "rt.workspacePrefs": z.looseObject({
    editors: stringMap.optional(),
    workspaces: stringMap.optional(),
    defaultEditor: z.string().optional(),
    entries: stringMap.optional(),
  }),
  "rt.homeSnapshot": z.looseObject(snapshot),
  "rt.teamSnapshot": z.looseObject({ ...snapshot, pullIntervalSec: z.number() }),
  "rt.sync": z.looseObject({
    autoResolve: z.array(
      z.looseObject({
        glob: z.union([z.string(), z.array(z.string())]),
        strategy: z.enum(["theirs", "ours"]),
        postResolve: z.array(z.string()).optional(),
      }),
    ).optional(),
  }),
  "rt.branchNaming": z.looseObject({ template: z.string().optional() }),
  "rt.variations": z.record(z.string(), z.array(z.looseObject({ name: z.string(), command: z.string() }))),
  "rt.presets": z.record(z.string(), z.looseObject({ entries: z.array(presetEntry) })),
  "rt.dopplerTemplate": z.array(z.looseObject({ path: z.string(), project: z.string(), config: z.string() })),
  "rt.worktreeApp": z.looseObject({ enabled: z.boolean().optional(), killProcesses: z.boolean().optional(), claudeHook: z.enum(["installed", "declined"]).optional() }),
  "rt.sdmEnrichment": z.record(
    z.string(),
    z.looseObject({
      label: z.string().optional(),
      tier: z.string().optional(),
      production: z.boolean().optional(),
      reasonSuggestion: z.string().optional(),
      db: z.looseObject({ database: z.string().optional(), schema: z.string().optional(), user: z.string().optional() }).optional(),
    }),
  ),
  "rt.gitStatus": z.looseObject({ sweep: z.boolean(), sweepIntervalSec: z.number(), fetchIntervalSec: z.number() }),
  "rt.hooks": z.looseObject({ enabled: z.boolean().optional(), hooks: z.record(z.string(), z.boolean()).optional() }),
  "rt.trustedBrowserOrigins": z.array(z.string()),
  "rt.integrations": z.looseObject({ forgeHost: z.string().optional(), switchboardUrl: z.string().optional() }),
} satisfies Record<string, z.ZodType>;

export type Value<K extends keyof typeof SCHEMAS> = z.infer<(typeof SCHEMAS)[K]>;
