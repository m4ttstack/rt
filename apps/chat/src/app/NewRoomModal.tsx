import { useState } from 'react';
import {
  Box,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { FormContainer, useForm, zodResolver } from '@mattstack/app-kit/forms';
import { useIsMobile } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import { z } from 'zod';

import { PaneRow, usePanePicker } from './PanePicker';
import type { ChatPane, InviteResult } from './PanePicker/types';

const MUTED = 'var(--tk-muted-text)';

const ROOM_RE = /^[a-z0-9._-]+$/;

const schema = z.object({
  room: z.string().regex(ROOM_RE, 'lowercase, digits, dashes'),
  seed: z.string(),
  wakeOn: z.enum(['mention', 'all']),
});

type NewRoomValues = z.infer<typeof schema>;

export interface NewRoomModalProps {
  opened: boolean;
  onClose: () => void;
  /** After a successful create: the room, the invite results when any were sent, and the panes they were sent to (so the caller can name them). */
  onCreated: (
    room: string,
    results: InviteResult[],
    picked: ChatPane[]
  ) => void;
  daemonReachable?: boolean;
}

export function NewRoomModal({
  opened,
  onClose,
  onCreated,
  daemonReachable,
}: NewRoomModalProps) {
  const mobile = useIsMobile();
  const pickPanes = usePanePicker();
  const form = useForm<NewRoomValues>({
    initialValues: { room: '', seed: '', wakeOn: 'mention' },
    validate: zodResolver(schema),
    validateInputOnChange: true,
  });
  const [picked, setPicked] = useState<ChatPane[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const values = form.values;
  const invalid = !schema.safeParse(values).success;

  function disable(pane: ChatPane): string | null {
    if (pane.agentStatus === 'blocked') return 'at a prompt · answer it first';
    if (pane.presence?.rooms.includes(values.room)) return `in #${values.room}`;
    return null;
  }

  async function pick() {
    const result = await pickPanes({
      context: `to invite to #${values.room || '…'}`,
      allowCreate: true,
      disable,
      preselected: picked.map(p => p.paneId),
    });
    if (result !== null) setPicked(result);
  }

  function removePane(paneId: string) {
    setPicked(prev => prev.filter(p => p.paneId !== paneId));
    setNotes(prev => {
      const next = { ...prev };
      delete next[paneId];
      return next;
    });
  }

  async function submit(invite: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch('/api/chat/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: values.room,
          seed: values.seed || undefined,
          wakeOn: values.wakeOn,
        }),
      });
      if (!res.ok)
        throw new Error(
          ((await res.json()) as { error?: string }).error ?? 'create failed'
        );
      let results: InviteResult[] = [];
      if (invite && picked.length > 0) {
        const inv = await fetch('/api/chat/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room: values.room,
            panes: picked.map(p => ({
              paneId: p.paneId,
              ...(notes[p.paneId]?.trim() ? { note: notes[p.paneId] } : {}),
            })),
          }),
        });
        if (!inv.ok)
          throw new Error(
            ((await inv.json()) as { error?: string }).error ?? 'invite failed'
          );
        results = ((await inv.json()) as { results: InviteResult[] }).results;
      }
      onCreated(values.room, results, invite ? picked : []);
      form.reset();
      setPicked([]);
      setNotes({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const submitDisabled = invalid || busy || daemonReachable === false;

  const title = (
    <Group gap="xs" wrap="nowrap">
      <Icon name="hash" size={18} />
      <Text size="xl" fw={700}>
        New room
      </Text>
    </Group>
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size={680}
      fullScreen={mobile}
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      closeButtonProps={{ 'aria-label': 'Close' }}
      data-testid="new-room-modal"
    >
      <FormContainer form={form} onSubmit={() => submit(true)} plain hideChrome>
        <TextInput
          label="Room"
          leftSection={
            <Text component="span" size="sm" style={{ color: MUTED }}>
              #
            </Text>
          }
          description="lowercase, digits, dashes · the room exists once you post the seed"
          {...form.getInputProps('room')}
        />
        <Textarea
          label="Seed"
          rows={4}
          description={
            <Stack gap={0}>
              <Text component="span" size="xs" style={{ color: MUTED }}>
                posted as matt · every invitee is told to read it first
              </Text>
              <Text component="span" size="xs" style={{ color: MUTED }}>
                markdown subset · blank line between points
              </Text>
            </Stack>
          }
          {...form.getInputProps('seed')}
        />
        <Select
          aria-label="Wakes"
          data={['mention', 'all']}
          allowDeselect={false}
          description="all = a war room, nobody has to @here"
          {...form.getInputProps('wakeOn')}
        />
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" fw={600} style={{ color: MUTED }}>
              AGENTS · {picked.length} to invite
            </Text>
            <Button
              size="xs"
              variant="default"
              type="button"
              onClick={() => void pick()}
              data-testid="new-room-pick"
            >
              pick panes
            </Button>
          </Group>
          {picked.map(pane => (
            <Box key={pane.paneId} data-testid={`picked-${pane.paneId}`}>
              <PaneRow
                pane={pane}
                extra={
                  <TextInput
                    aria-label="note for this pane"
                    placeholder="note for this pane (optional)"
                    value={notes[pane.paneId] ?? ''}
                    onChange={e => {
                      const value = e.currentTarget.value;
                      setNotes(prev => ({ ...prev, [pane.paneId]: value }));
                    }}
                  />
                }
                trailing={
                  <UnstyledButton
                    aria-label="Remove"
                    type="button"
                    onClick={() => removePane(pane.paneId)}
                  >
                    <Icon name="close" size={14} />
                  </UnstyledButton>
                }
              />
            </Box>
          ))}
        </Stack>
        {error && (
          <Text size="xs" c="bad">
            {error}
          </Text>
        )}
        {daemonReachable === false && (
          <Text size="xs" style={{ color: MUTED }}>
            rt daemon unreachable · the draft is kept
          </Text>
        )}
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
            type="button"
            disabled={submitDisabled}
            onClick={() => void submit(false)}
            data-testid="new-room-create-only"
          >
            Create without inviting
          </Button>
          <Button
            size="sm"
            type="button"
            disabled={submitDisabled}
            onClick={() => void submit(true)}
            data-testid="new-room-create"
          >
            Create #{values.room} · invite {picked.length}
          </Button>
        </Group>
      </FormContainer>
    </Modal>
  );
}
