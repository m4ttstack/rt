import {
  agentStart as rtAgentStart,
  agentResume as rtAgentResume,
  type Commands,
} from "@mattstack/rt-client";

export interface AgentLaunchResult {
  agentId: string;
  sessionId: string;
  paneId: string;
  tabId: string;
  workspaceId: string;
  focusedExisting: boolean;
}

export interface AgentIo {
  agentStart: typeof rtAgentStart;
  agentResume: typeof rtAgentResume;
}

export async function startAgentPane(
  opts: {
    repo: string;
    cwd: string;
    prompt: string;
    workspaceLabel: string;
    tabLabel: string;
    account?: string;
    model?: string;
    effort?: string;
  },
  io?: AgentIo,
): Promise<AgentLaunchResult> {
  const ioInstance = io || { agentStart: rtAgentStart, agentResume: rtAgentResume };

  const payload: Commands["agent:start"]["payload"] = {
    repo: opts.repo,
    cwd: opts.cwd,
    prompt: opts.prompt,
    surface: "herdr",
    workspace: opts.workspaceLabel,
    tab: opts.tabLabel,
    ...(opts.account !== undefined ? { account: opts.account } : {}),
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
  };

  const response = await ioInstance.agentStart(payload);

  if (!response.ok) {
    if (response.error && response.error.match(/already open; focused it/)) {
      return {
        agentId: "",
        sessionId: "",
        paneId: "",
        tabId: "",
        workspaceId: "",
        focusedExisting: true,
      };
    }
    throw new Error(response.error || "unknown error");
  }

  if (!response.data) {
    throw new Error("no data in response");
  }

  const data = response.data;
  return {
    agentId: data.id,
    sessionId: data.sessionId,
    paneId: data.paneId || "",
    tabId: data.tabId || "",
    workspaceId: data.workspaceId || "",
    focusedExisting: false,
  };
}

export async function resumeAgentPane(
  opts: {
    agentId: string;
    prompt?: string;
    workspaceLabel: string;
    tabLabel: string;
  },
  io?: AgentIo,
): Promise<AgentLaunchResult> {
  const ioInstance = io || { agentStart: rtAgentStart, agentResume: rtAgentResume };

  const payload: Commands["agent:resume"]["payload"] = {
    id: opts.agentId,
    surface: "herdr",
    workspace: opts.workspaceLabel,
    tab: opts.tabLabel,
    ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
  };

  const response = await ioInstance.agentResume(payload);

  if (!response.ok) {
    if (response.error && response.error.match(/already open; focused it/)) {
      return {
        agentId: "",
        sessionId: "",
        paneId: "",
        tabId: "",
        workspaceId: "",
        focusedExisting: true,
      };
    }
    throw new Error(response.error || "unknown error");
  }

  if (!response.data) {
    throw new Error("no data in response");
  }

  const data = response.data;
  return {
    agentId: data.id,
    sessionId: data.sessionId,
    paneId: data.paneId || "",
    tabId: data.tabId || "",
    workspaceId: data.workspaceId || "",
    focusedExisting: false,
  };
}
