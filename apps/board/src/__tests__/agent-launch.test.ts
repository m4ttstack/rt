import { describe, expect, test } from 'bun:test';

import {
  resumeAgentPane,
  startAgentPane,
  type AgentIo,
  type AgentLaunchResult,
} from '../agent-launch.ts';

describe('agent launch adapter', () => {
  describe('startAgentPane', () => {
    test('success path returns record ids and focusedExisting false', async () => {
      const fakeIo: AgentIo = {
        agentStart: async payload => ({
          ok: true,
          data: {
            id: 'agent-123',
            repo: 'board',
            cwd: '/repo',
            provider: 'test',
            surface: 'herdr' as const,
            sessionId: 'session-456',
            paneId: 'pane-789',
            tabId: 'tab-101',
            workspaceId: 'workspace-202',
            createdAt: Date.now(),
          },
        }),
        agentResume: async () => {
          throw new Error('not used');
        },
      };

      const result = await startAgentPane(
        {
          repo: 'board',
          cwd: '/repo',
          prompt: 'test prompt',
          workspaceLabel: 'test-workspace',
          tabLabel: 'test-tab',
        },
        fakeIo
      );

      expect(result).toEqual({
        agentId: 'agent-123',
        sessionId: 'session-456',
        paneId: 'pane-789',
        tabId: 'tab-101',
        workspaceId: 'workspace-202',
        focusedExisting: false,
      });
    });

    test('passes surface herdr, workspace, tab through', async () => {
      let capturedPayload: any;
      const fakeIo: AgentIo = {
        agentStart: async payload => {
          capturedPayload = payload;
          return {
            ok: true,
            data: {
              id: 'a',
              repo: 'b',
              cwd: 'c',
              provider: 'd',
              surface: 'herdr' as const,
              sessionId: 's',
              paneId: 'p',
              tabId: 't',
              workspaceId: 'w',
              createdAt: Date.now(),
            },
          };
        },
        agentResume: async () => {
          throw new Error('not used');
        },
      };

      await startAgentPane(
        {
          repo: 'board',
          cwd: '/repo',
          prompt: 'my prompt',
          workspaceLabel: 'my-workspace',
          tabLabel: 'my-tab',
        },
        fakeIo
      );

      expect(capturedPayload.surface).toBe('herdr');
      expect(capturedPayload.workspace).toBe('my-workspace');
      expect(capturedPayload.tab).toBe('my-tab');
      expect(capturedPayload.prompt).toBe('my prompt');
      expect(capturedPayload.repo).toBe('board');
      expect(capturedPayload.cwd).toBe('/repo');
    });

    test('passes account, model, effort verbatim when present', async () => {
      let capturedPayload: any;
      const fakeIo: AgentIo = {
        agentStart: async payload => {
          capturedPayload = payload;
          return {
            ok: true,
            data: {
              id: 'a',
              repo: 'b',
              cwd: 'c',
              provider: 'd',
              surface: 'herdr' as const,
              sessionId: 's',
              paneId: 'p',
              tabId: 't',
              workspaceId: 'w',
              createdAt: Date.now(),
            },
          };
        },
        agentResume: async () => {
          throw new Error('not used');
        },
      };

      await startAgentPane(
        {
          repo: 'board',
          cwd: '/repo',
          prompt: 'test',
          workspaceLabel: 'ws',
          tabLabel: 'tab',
          account: 'test-account',
          model: 'opus',
          effort: 'high',
        },
        fakeIo
      );

      expect(capturedPayload.account).toBe('test-account');
      expect(capturedPayload.model).toBe('opus');
      expect(capturedPayload.effort).toBe('high');
    });

    test('omits undefined account, model, effort', async () => {
      let capturedPayload: any;
      const fakeIo: AgentIo = {
        agentStart: async payload => {
          capturedPayload = payload;
          return {
            ok: true,
            data: {
              id: 'a',
              repo: 'b',
              cwd: 'c',
              provider: 'd',
              surface: 'herdr' as const,
              sessionId: 's',
              paneId: 'p',
              tabId: 't',
              workspaceId: 'w',
              createdAt: Date.now(),
            },
          };
        },
        agentResume: async () => {
          throw new Error('not used');
        },
      };

      await startAgentPane(
        {
          repo: 'board',
          cwd: '/repo',
          prompt: 'test',
          workspaceLabel: 'ws',
          tabLabel: 'tab',
          account: undefined,
          model: undefined,
          effort: undefined,
        },
        fakeIo
      );

      expect('account' in capturedPayload).toBe(false);
      expect('model' in capturedPayload).toBe(false);
      expect('effort' in capturedPayload).toBe(false);
    });

    test('dedup error maps to focusedExisting true with empty ids', async () => {
      const fakeIo: AgentIo = {
        agentStart: async () => ({
          ok: false,
          error: 'already open; focused it',
        }),
        agentResume: async () => {
          throw new Error('not used');
        },
      };

      const result = await startAgentPane(
        {
          repo: 'board',
          cwd: '/repo',
          prompt: 'test',
          workspaceLabel: 'ws',
          tabLabel: 'tab',
        },
        fakeIo
      );

      expect(result).toEqual({
        agentId: '',
        sessionId: '',
        paneId: '',
        tabId: '',
        workspaceId: '',
        focusedExisting: true,
      });
    });

    test('other error throws with daemon message', async () => {
      const fakeIo: AgentIo = {
        agentStart: async () => ({
          ok: false,
          error: 'something went wrong',
        }),
        agentResume: async () => {
          throw new Error('not used');
        },
      };

      await expect(
        startAgentPane(
          {
            repo: 'board',
            cwd: '/repo',
            prompt: 'test',
            workspaceLabel: 'ws',
            tabLabel: 'tab',
          },
          fakeIo
        )
      ).rejects.toThrow('something went wrong');
    });
  });

  describe('resumeAgentPane', () => {
    test('success path returns record ids and focusedExisting false', async () => {
      const fakeIo: AgentIo = {
        agentStart: async () => {
          throw new Error('not used');
        },
        agentResume: async payload => ({
          ok: true,
          data: {
            id: 'agent-789',
            repo: 'b',
            cwd: 'c',
            provider: 'd',
            surface: 'herdr' as const,
            sessionId: 'session-999',
            paneId: 'pane-111',
            tabId: 'tab-222',
            workspaceId: 'workspace-333',
            createdAt: Date.now(),
          },
        }),
      };

      const result = await resumeAgentPane(
        {
          agentId: 'agent-789',
          prompt: 'continue',
          workspaceLabel: 'my-workspace',
          tabLabel: 'my-tab',
        },
        fakeIo
      );

      expect(result).toEqual({
        agentId: 'agent-789',
        sessionId: 'session-999',
        paneId: 'pane-111',
        tabId: 'tab-222',
        workspaceId: 'workspace-333',
        focusedExisting: false,
      });
    });

    test('passes id, prompt, surface herdr, workspace, tab through', async () => {
      let capturedPayload: any;
      const fakeIo: AgentIo = {
        agentStart: async () => {
          throw new Error('not used');
        },
        agentResume: async payload => {
          capturedPayload = payload;
          return {
            ok: true,
            data: {
              id: 'a',
              repo: 'b',
              cwd: 'c',
              provider: 'd',
              surface: 'herdr' as const,
              sessionId: 's',
              paneId: 'p',
              tabId: 't',
              workspaceId: 'w',
              createdAt: Date.now(),
            },
          };
        },
      };

      await resumeAgentPane(
        {
          agentId: 'my-agent',
          prompt: 'my prompt',
          workspaceLabel: 'my-workspace',
          tabLabel: 'my-tab',
        },
        fakeIo
      );

      expect(capturedPayload.id).toBe('my-agent');
      expect(capturedPayload.prompt).toBe('my prompt');
      expect(capturedPayload.surface).toBe('herdr');
      expect(capturedPayload.workspace).toBe('my-workspace');
      expect(capturedPayload.tab).toBe('my-tab');
    });

    test('promptless resume omits prompt key entirely', async () => {
      let capturedPayload: any;
      const fakeIo: AgentIo = {
        agentStart: async () => {
          throw new Error('not used');
        },
        agentResume: async payload => {
          capturedPayload = payload;
          return {
            ok: true,
            data: {
              id: 'a',
              repo: 'b',
              cwd: 'c',
              provider: 'd',
              surface: 'herdr' as const,
              sessionId: 's',
              paneId: 'p',
              tabId: 't',
              workspaceId: 'w',
              createdAt: Date.now(),
            },
          };
        },
      };

      await resumeAgentPane(
        {
          agentId: 'my-agent',
          workspaceLabel: 'my-workspace',
          tabLabel: 'my-tab',
        },
        fakeIo
      );

      expect('prompt' in capturedPayload).toBe(false);
      expect(capturedPayload.id).toBe('my-agent');
      expect(capturedPayload.surface).toBe('herdr');
      expect(capturedPayload.workspace).toBe('my-workspace');
      expect(capturedPayload.tab).toBe('my-tab');
    });

    test('dedup error maps to focusedExisting true with empty ids', async () => {
      const fakeIo: AgentIo = {
        agentStart: async () => {
          throw new Error('not used');
        },
        agentResume: async () => ({
          ok: false,
          error: 'already open; focused it',
        }),
      };

      const result = await resumeAgentPane(
        {
          agentId: 'my-agent',
          workspaceLabel: 'ws',
          tabLabel: 'tab',
        },
        fakeIo
      );

      expect(result).toEqual({
        agentId: '',
        sessionId: '',
        paneId: '',
        tabId: '',
        workspaceId: '',
        focusedExisting: true,
      });
    });

    test('other error throws with daemon message', async () => {
      const fakeIo: AgentIo = {
        agentStart: async () => {
          throw new Error('not used');
        },
        agentResume: async () => ({
          ok: false,
          error: 'something went wrong',
        }),
      };

      await expect(
        resumeAgentPane(
          {
            agentId: 'my-agent',
            workspaceLabel: 'ws',
            tabLabel: 'tab',
          },
          fakeIo
        )
      ).rejects.toThrow('something went wrong');
    });

    test('handles missing optional fields in response with empty string coalescing', async () => {
      const fakeIo: AgentIo = {
        agentStart: async () => {
          throw new Error('not used');
        },
        agentResume: async () => ({
          ok: true,
          data: {
            id: 'agent-123',
            repo: 'b',
            cwd: 'c',
            provider: 'd',
            surface: 'herdr' as const,
            sessionId: 'session-456',
            createdAt: Date.now(),
            // paneId, tabId, workspaceId are missing (optional)
          } as any,
        }),
      };

      const result = await resumeAgentPane(
        {
          agentId: 'agent-123',
          workspaceLabel: 'ws',
          tabLabel: 'tab',
        },
        fakeIo
      );

      expect(result.agentId).toBe('agent-123');
      expect(result.sessionId).toBe('session-456');
      expect(result.paneId).toBe('');
      expect(result.tabId).toBe('');
      expect(result.workspaceId).toBe('');
      expect(result.focusedExisting).toBe(false);
    });
  });
});
