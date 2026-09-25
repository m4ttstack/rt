export { rtCommand, DEFAULT_SOCK } from "./transport.ts";
export type { RtResponse, RtClientOptions } from "./transport.ts";
export { guardTestDaemonEnv } from "./test-isolation.ts";

export {
  readProjectMRs,
  readDiscussions,
  readMrsByBranch,
  readBranchCache,
  resolveForgeToken,
  listRuns,
  getRun,
  abandonRun,
  chatJoin,
  chatLeave,
  chatAck,
  chatClaim,
  chatRelease,
  chatPost,
  chatRead,
  chatRooms,
  chatWho,
  chatMark,
  chatMessages,
  chatSignIn,
  chatSignOut,
  chatAway,
  chatBack,
  chatBuddies,
  chatDm,
  chatArchive,
  chatDmOpen,
  eventsHead,
  eventsEmit,
  eventsWait,
  eventsList,
  agentStart,
  agentResume,
  agentGet,
  agentList,
  paneList,
  panePeek,
  paneSpawn,
  paneAccounts,
  paneDirectories,
  chatInvite,
  paneSend,
  paneFocus,
  reconcilerStatus,
  reconcilerClear,
  gateOpen,
  gateAsk,
  gateForkCheck,
  gateAnswer,
  gateWait,
  gateList,
  gatePark,
  gateClose,
  gateSubscribe,
  gateUnsubscribe,
  gateSubscriptions,
  herdStart,
  herdSpawn,
  herdAsk,
  herdMilestone,
  herdAnswer,
  herdReport,
  herdGates,
  herdStatus,
  herdList,
  herdResume,
  herdClose,
  herdAttend,
  herdWrapUp,
  herdStopHidden,
  bgEnsure,
  bgStatus,
  bgStop,
  bgRelease,
} from "./client.ts";

export { COMMAND_NAMES, GATE_BY_PANE, gateOptionValue, gateOptionLabel } from "./commands.ts";
export { GATE_FORM_OPTION_CAP, gatePresentation } from "./gate-presentation.ts";
export { normalizeGateOptions, normalizeGateQuestions } from "./gate-options.ts";
export type { GateOptionObject } from "./gate-options.ts";
export { unwrapGateAnswerValue, validateGateAnswers } from "./gate-answers.ts";
export type { GateAnswerWire } from "./gate-answers.ts";
export type {
  Discussion,
  DemandDecl,
  ProjectMRsScope,
  ProjectSyncError,
  ProjectSyncErrorKind,
  ProjectMRsData,
  DiscussionsData,
  MrByBranchEntry,
  MrByBranchData,
  BranchEnrichment,
  Commands,
  CommandName,
  ForgeSlug,
  ForgeTokenData,
  Attention,
  RunSummary,
  RunStageRow,
  RunFieldRow,
  RunDecisionRow,
  RunDetail,
  WakeMode,
  ChatMember,
  ChatMessage,
  ChatClaimOutcome,
  RoomSummary,
  BuddyStatus,
  PresenceRow,
  AgentRecord,
  AgentSurface,
  AgentStatus,
  ExecutorState,
  ExecutorView,
  ReconcilerStatus,
  ChatPane,
  PaneAccount,
  PaneDirectory,
  InviteResult,
  PaneDelivery,
  PaneSendResult,
  PaneFocusResult,
  GateStatus,
  GateOption,
  GateOrigin,
  GateQuestion,
  GateAnswer,
  GateRow,
  GateSubscription,
  HerdInfo,
  HerdListRow,
  HerdJobInfo,
  HerdStatusData,
} from "./commands.ts";

export { subscribe, createRelay, DEFAULT_WS_URL } from "./relay.ts";
export type { RelayEventType } from "./relay.ts";

export { daemonHealth } from "./health.ts";

export { repoNameForPath } from "./repos.ts";

export { decidePlacement, openSmartPane } from "./smart-pane.ts";
export type { Placement, PlacementOpts, HerdrCall } from "./smart-pane.ts";

export { BG_PREFIX, parsePaneRef, formatPaneRef } from "./pane-ref.ts";
export type { PaneServer, PaneRef } from "./pane-ref.ts";

// ─── Settings (RT-50) ────────────────────────────────────────────────────────

export { getSetting, listSettings, explainSetting, expandVariables, SCOPE_ORDER, setSettingsWarnSink, mergedValueWith, currentMergedValue, listStoreRepoIdentities, listUnregisteredSettings, repoSectionsFor } from "./settings/resolve.ts";
export type {
  Scope,
  Provenance,
  ResolveOpts,
  Resolved,
  InvalidScope,
  ListedSetting,
  ExplainRow,
  ExpandCtx,
} from "./settings/resolve.ts";

export { setSetting, unsetSetting } from "./settings/write.ts";
export type { SetSettingOpts } from "./settings/write.ts";
export { validateWrite } from "./settings/validate-write.ts";
export type { WriteRefusalKind, WriteVerdict } from "./settings/validate-write.ts";

export { getDef, allDefs, validateValue, isMigrated } from "./settings/registry-machinery.ts";
export type { SettingDef, SettingScope } from "./settings/registry-machinery.ts";
export { checkSchema, validateJson, layerJsonSchema, formatIssuePath, firstIssueText, hasSchema } from "./settings/schema.ts";
export type { SchemaIssue, JsonSchema } from "./settings/schema.ts";
export { checkStores } from "./settings/check.ts";
export type { CheckFinding, CheckReport } from "./settings/check.ts";
export { REGISTRY } from "./settings/registry-defs.ts";
export { NOTIFICATION_EVENT_KEYS, NOTIFICATION_DEFAULTS } from "./settings/notification-events.ts";

export { readStore, listTeams } from "./settings/stores.ts";
export type { StoreFile } from "./settings/stores.ts";

export {
  normalizeRemote, identityFromRemote, deriveRepoIdentity, clearIdentityMemo,
  serializeIdentity, parseIdentity, resolveNameToIdentity,
  type RepoIdentity,
} from "./settings/identity.ts";
