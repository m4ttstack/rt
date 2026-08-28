import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from '@mattstack/app-kit/core';
import { useIsMobile } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import { notifications } from '@mattstack/app-kit/notifications';

import { NewPaneForm } from './NewPaneForm';
import { PaneRow } from './PaneRow';
import type { ChatPane, PickPanesOptions } from './types';

const ORDER: Record<string, number> = { live: 0, idle: 1, deaf: 2 };

export function sortPanes(panes: ChatPane[]): ChatPane[] {
  return panes
    .map((p, i) => ({ p, i }))
    .sort(
      (a, b) =>
        (ORDER[a.p.presence?.status ?? ''] ?? 3) -
          (ORDER[b.p.presence?.status ?? ''] ?? 3) || a.i - b.i
    )
    .map(({ p }) => p);
}

export function matchesFilter(pane: ChatPane, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [
    pane.presence?.handle,
    pane.workspace,
    pane.title,
    pane.repo,
    pane.cwd,
    pane.paneId,
  ]
    .filter((v): v is string => typeof v === 'string')
    .some(v => v.toLowerCase().includes(needle));
}

interface Starting {
  key: string;
  cwd: string;
}

export function PanePickerModal({
  opts,
  onDone,
}: {
  opts: PickPanesOptions;
  onDone: (r: ChatPane[] | null) => void;
}) {
  const multiple = opts.multiple ?? true;
  const [available, setAvailable] = useState<boolean | null>(null);
  const [panes, setPanes] = useState<ChatPane[]>([]);
  const [notReady, setNotReady] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState<Starting[]>([]);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(opts.preselected ?? [])
  );
  const [filter, setFilter] = useState('');
  const [peeks, setPeeks] = useState<Record<string, string[] | 'loading'>>({});
  const [view, setView] = useState<'list' | 'new'>('list');
  const mobile = useIsMobile();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/panes')
      .then(res => res.json())
      .then((data: { available?: boolean; panes?: ChatPane[] }) => {
        if (cancelled) return;
        setAvailable(data.available !== false);
        setPanes(sortPanes(data.panes ?? []));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(
    () => panes.filter(p => matchesFilter(p, filter)),
    [panes, filter]
  );

  function reasonFor(pane: ChatPane): string | null {
    if (notReady.has(pane.paneId))
      return 'never reached idle · peek to see why';
    return opts.disable?.(pane) ?? null;
  }

  function toggle(pane: ChatPane) {
    setSelected(prev => {
      const next = new Set(multiple ? prev : []);
      if (prev.has(pane.paneId)) next.delete(pane.paneId);
      else next.add(pane.paneId);
      return next;
    });
  }

  function peek(pane: ChatPane) {
    if (peeks[pane.paneId]) {
      setPeeks(prev => {
        const next = { ...prev };
        delete next[pane.paneId];
        return next;
      });
      return;
    }
    setPeeks(prev => ({ ...prev, [pane.paneId]: 'loading' }));
    // Pane ids never contain a slash; sent bare so the server's `:id` and the tests' URL match.
    fetch(`/api/panes/${pane.paneId}/peek?lines=8`)
      .then(res => res.json())
      .then((data: { lines?: string[] }) =>
        setPeeks(prev => ({ ...prev, [pane.paneId]: data.lines ?? [] }))
      )
      .catch(() =>
        setPeeks(prev => ({
          ...prev,
          [pane.paneId]: ['(could not read the pane)'],
        }))
      );
  }

  function start(args: {
    cwd: string;
    account?: string;
    model?: string;
    effort?: string;
    prompt?: string;
    workspace?: string;
  }) {
    const key = `starting-${Date.now()}`;
    setStarting(prev => [...prev, { key, cwd: args.cwd }]);
    setView('list');
    fetch('/api/panes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
      .then(async res => {
        if (!res.ok)
          throw new Error(
            ((await res.json()) as { error?: string }).error ?? 'spawn failed'
          );
        return (await res.json()) as { pane: ChatPane; ready: boolean };
      })
      .then(({ pane, ready }) => {
        setStarting(prev => prev.filter(s => s.key !== key));
        setPanes(prev =>
          sortPanes([...prev.filter(p => p.paneId !== pane.paneId), pane])
        );
        if (ready)
          setSelected(
            prev => new Set(multiple ? [...prev, pane.paneId] : [pane.paneId])
          );
        else setNotReady(prev => new Set([...prev, pane.paneId]));
      })
      .catch((err: Error) => {
        setStarting(prev => prev.filter(s => s.key !== key));
        notifications.error(`Couldn't start the pane: ${err.message}`);
      });
  }

  const picked = panes.filter(p => selected.has(p.paneId) && !reasonFor(p));
  const title = (
    <Group gap="xs" wrap="nowrap">
      <Icon name="terminal" size={18} />
      <Text size="xl" fw={700}>
        {view === 'new' ? 'New pane' : 'Pick herdr panes'}
      </Text>
      {opts.context && view === 'list' && (
        <Text size="sm" style={{ color: 'var(--tk-muted-text)' }}>
          {opts.context}
        </Text>
      )}
    </Group>
  );

  return (
    <Modal
      opened
      onClose={() => onDone(null)}
      title={title}
      size={640}
      fullScreen={mobile}
      data-testid="pane-picker"
      closeButtonProps={{ 'aria-label': 'Close' }}
      styles={{ content: { background: 'var(--tk-panel)' } }}
    >
      {view === 'new' ? (
        <NewPaneForm onBack={() => setView('list')} onStart={start} />
      ) : (
        <Stack gap="xs">
          {available === false ? (
            <Text size="sm">
              herdr is not running, so there are no panes to list.
            </Text>
          ) : (
            <>
              <TextInput
                size="xs"
                placeholder="filter by handle, workspace, title, repo, path"
                leftSection={<Icon name="search" size={13} />}
                value={filter}
                onChange={e => setFilter(e.currentTarget.value)}
                data-testid="pane-filter"
                aria-label="Filter panes"
              />
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs" style={{ color: 'var(--tk-muted-text)' }}>
                  {panes.length} panes running Claude
                </Text>
                <Group gap="xs" wrap="nowrap">
                  <Text size="xs" style={{ color: 'var(--tk-muted-text)' }}>
                    {picked.length} selected
                  </Text>
                  {opts.allowCreate && (
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={<Icon name="plus" size={14} />}
                      onClick={() => setView('new')}
                      data-testid="pane-new"
                    >
                      new pane
                    </Button>
                  )}
                </Group>
              </Group>
              <Stack
                gap={0}
                style={{
                  border: '1px solid var(--tk-border)',
                  borderRadius: 'var(--mantine-radius-md)',
                  background: 'var(--tk-panel)',
                  maxHeight: mobile ? undefined : 560,
                  overflow: 'auto',
                  padding: '2px 0',
                }}
              >
                {starting.map((s, i) => (
                  <PaneRow
                    key={s.key}
                    first={i === 0}
                    pane={{
                      paneId: s.key,
                      workspace: 'chat',
                      cwd: s.cwd,
                      agentStatus: 'unknown',
                    }}
                    disabledReason="starting claude · selectable when idle"
                    onToggle={() => {}}
                  />
                ))}
                {visible.map((pane, i) => (
                  <PaneRow
                    key={pane.paneId}
                    first={starting.length === 0 && i === 0}
                    pane={pane}
                    selected={selected.has(pane.paneId)}
                    disabledReason={reasonFor(pane)}
                    onToggle={() => toggle(pane)}
                    onPeek={() => peek(pane)}
                    peek={peeks[pane.paneId]}
                  />
                ))}
              </Stack>
            </>
          )}
          <Group
            justify="flex-end"
            gap="xs"
            style={{
              borderTop: '1px solid var(--tk-border-soft)',
              paddingTop: 'var(--mantine-spacing-xs)',
            }}
          >
            <div style={{ flex: 1 }} />
            <Button
              variant="default"
              size="sm"
              onClick={() => onDone(null)}
              data-testid="pane-cancel"
            >
              Cancel
            </Button>
            {available !== false && (
              <Button
                size="sm"
                leftSection={<Icon name="check" size={14} />}
                onClick={() => onDone(picked)}
                data-testid="pane-use"
              >
                Use {picked.length} {picked.length === 1 ? 'pane' : 'panes'}
              </Button>
            )}
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
