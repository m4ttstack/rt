import { useEffect, useState } from 'react';
import {
  Button,
  Group,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from '@mattstack/app-kit/core';

import type { PaneAccount, PaneDirectory } from './types';

const MUTED = 'var(--tk-muted-text)';
const BORDER = 'var(--tk-border)';

const MODELS = ['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5'];
const EFFORTS = [
  { value: '', label: '' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'max', label: 'max' },
];

export interface NewPaneFormProps {
  onBack: () => void;
  onStart: (args: {
    cwd: string;
    account?: string;
    model?: string;
    effort?: string;
    prompt?: string;
    workspace?: string;
  }) => void;
}

export function NewPaneForm({ onBack, onStart }: NewPaneFormProps) {
  const [cwd, setCwd] = useState('');
  const [suggestions, setSuggestions] = useState<PaneDirectory[]>([]);
  const [accounts, setAccounts] = useState<PaneAccount[]>([]);
  const [account, setAccount] = useState<string | null>(null);
  const [model, setModel] = useState('claude-fable-5');
  const [effort, setEffort] = useState('');
  const [workspace, setWorkspace] = useState('chat');
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/panes/accounts')
      .then(res => res.json())
      .then((data: { accounts?: PaneAccount[] }) => {
        if (cancelled) return;
        const list = data.accounts ?? [];
        setAccounts(list);
        if (list.length > 0) setAccount(list[0]!.alias ?? list[0]!.email);
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/panes/directories?q=${encodeURIComponent(cwd)}`)
      .then(res => res.json())
      .then((data: { directories?: PaneDirectory[] }) => {
        if (!cancelled) setSuggestions(data.directories ?? []);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const command = account
    ? `cswap run ${account} --share-history -- claude --model ${model}${effort ? ` --effort ${effort}` : ''}`
    : `claude --model ${model}${effort ? ` --effort ${effort}` : ''}`;

  return (
    <Stack gap="sm">
      <Stack gap={4}>
        <TextInput
          label="Directory"
          placeholder="/path/to/a/repo"
          value={cwd}
          onChange={e => setCwd(e.currentTarget.value)}
        />
        {suggestions.length > 0 && (
          <Stack gap={2}>
            {suggestions.map(dir => (
              <UnstyledButton
                key={dir.path}
                onClick={() => {
                  setCwd(dir.path);
                  setSuggestions([]);
                }}
                style={{
                  height: 34,
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--mantine-spacing-sm)',
                  padding: '0 var(--mantine-spacing-sm)',
                  borderRadius: 'var(--mantine-radius-sm)',
                  border: `1px solid ${BORDER}`,
                  textAlign: 'left',
                }}
              >
                <Text component="span" size="sm">
                  {dir.path}
                </Text>
                <Text component="span" size="xs" style={{ color: MUTED }}>
                  {[dir.repo, dir.branch].filter(Boolean).join(' · ')}
                </Text>
              </UnstyledButton>
            ))}
          </Stack>
        )}
      </Stack>
      {accounts.length > 0 && (
        <Select
          label="Account"
          data={accounts.map(a => ({
            value: a.alias ?? a.email,
            label: `${a.alias ?? a.email} · ${a.headroom ?? ''}`,
          }))}
          value={account}
          onChange={setAccount}
          allowDeselect={false}
        />
      )}
      <Group grow>
        <Select
          label="Model"
          data={MODELS}
          value={model}
          onChange={v => setModel(v ?? MODELS[0]!)}
          allowDeselect={false}
        />
        <Select
          label="Effort"
          data={EFFORTS}
          value={effort}
          onChange={v => setEffort(v ?? '')}
          allowDeselect={false}
        />
      </Group>
      <TextInput
        label="Workspace"
        value={workspace}
        onChange={e => setWorkspace(e.currentTarget.value)}
      />
      <Textarea
        label="Opening prompt"
        value={prompt}
        onChange={e => setPrompt(e.currentTarget.value)}
        rows={2}
      />
      <Text
        size="xs"
        style={{
          color: MUTED,
          fontFamily: 'var(--mantine-font-family-monospace)',
        }}
      >
        {command}
      </Text>
      <Group
        justify="flex-end"
        gap="xs"
        style={{
          borderTop: '1px solid var(--tk-border-soft)',
          paddingTop: 'var(--mantine-spacing-xs)',
        }}
      >
        <Button
          variant="default"
          size="sm"
          onClick={onBack}
          data-testid="pane-back"
        >
          Back
        </Button>
        <Button
          size="sm"
          disabled={!cwd.startsWith('/')}
          onClick={() =>
            onStart({
              cwd,
              account: account ?? undefined,
              model,
              effort: effort || undefined,
              prompt: prompt || undefined,
              workspace,
            })
          }
          data-testid="pane-start"
        >
          Start pane
        </Button>
      </Group>
    </Stack>
  );
}
