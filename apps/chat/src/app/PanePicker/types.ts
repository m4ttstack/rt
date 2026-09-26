import type { ChatPane } from '@mattstack/rt-client';

export type {
  AgentStatus,
  ChatPane,
  InviteResult,
  PaneAccount,
  PaneDirectory,
} from '@mattstack/rt-client';
export interface PickPanesOptions {
  context?: string;
  multiple?: boolean;
  disable?: (pane: ChatPane) => string | null;
  preselected?: string[];
  allowCreate?: boolean;
}
export type PickPanes = (opts?: PickPanesOptions) => Promise<ChatPane[] | null>;
