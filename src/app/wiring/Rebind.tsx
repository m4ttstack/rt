import { useMemo, useState } from 'react';

import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
} from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import type { BindingSite, SkillsComposition } from './outline';
import { invertBindings, suffixOf } from './outline';
import { SOFT_RULE } from './SlotRow';

/** One row of the blast radius: the same facts `InverseIndex`'s site row
    shows, at confirm-step scale rather than drawer scale. */
function BlastSite({ site }: { site: BindingSite }) {
  const { text } = useSchemeColors();
  return (
    <Group
      gap="xs"
      wrap="nowrap"
      px="sm"
      py={6}
      data-testid={`blast-site-${site.ref}:${site.slot}`}
    >
      <Badge size="xs" variant="light" color="warn">
        {site.kind}
      </Badge>
      <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
        {site.verb ?? suffixOf(site.ref)}
      </Text>
      <Text size="xs" c={text.muted} style={{ flex: 'none' }}>
        slot {site.slot}
      </Text>
    </Group>
  );
}

/** One direction of the blast radius: the fill's other binding sites, or the
    stated fact that there are none. Shared by the outgoing and incoming
    halves so the two can never render the empty case differently. */
function BlastRadius({
  dotColor,
  headline,
  note,
  sites,
  emptyText,
}: {
  dotColor: string;
  headline: string;
  note?: string;
  sites: BindingSite[];
  emptyText: string;
}) {
  const { text, bg } = useSchemeColors();
  return (
    <Stack gap={4}>
      <Group gap={6} wrap="nowrap">
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: dotColor,
            flex: 'none',
          }}
        />
        <Text size="sm" fw={600}>
          {headline}
        </Text>
      </Group>
      {note && (
        <Text size="xs" c={text.muted} pl={12}>
          {note}
        </Text>
      )}
      {sites.length === 0 ? (
        <Paper
          bg={bg.level3}
          radius="sm"
          ml={12}
          p="xs"
          style={{ border: `1px solid ${SOFT_RULE}` }}
        >
          <Text size="xs" c={text.muted}>
            {emptyText}
          </Text>
        </Paper>
      ) : (
        <Paper
          bg={bg.level3}
          radius="sm"
          ml={12}
          style={{ border: `1px solid ${SOFT_RULE}` }}
        >
          {sites.map((site, i) => (
            <div
              key={`${site.ref}:${site.slot}`}
              style={
                i === 0 ? undefined : { borderTop: `1px solid ${SOFT_RULE}` }
              }
            >
              <BlastSite site={site} />
            </div>
          ))}
        </Paper>
      )}
    </Stack>
  );
}

export interface RebindProps {
  pack: string;
  /** The roster verb whose slot is being rebound. */
  verb: string;
  slot: string;
  /** The real payload `/api/skills/composition` answers -- the same object
      `WiringMap`/`InverseIndex` read, not a narrowed copy. The blast radius
      has to invert the pack's FULL binder set (roster verbs are only a
      fraction of it -- pipeline stages and other plugins' skills bind fills
      too), so this component cannot work from anything narrower. */
  composition: SkillsComposition;
  /** Fired with the manifest path when "Open manifest" is pressed. Disabled
      whenever `composition.manifestPath` is null or absent -- there is
      nothing to open. */
  onOpenManifest?: (manifestPath: string) => void;
  /** Fired with the edit text when "Copy" is pressed. Disabled under the
      same condition as `onOpenManifest`. */
  onCopy?: (edit: string) => void;
  onClose?: () => void;
}

/**
 * The staged rebind and its blast radius. rt has no verb that writes a
 * binding (`readManifestBindings` in `lib/skills/sources.ts` has no writer
 * counterpart), so this stops short of applying anything: it stages the
 * choice, shows what rebinding would touch on both sides, and -- in place of
 * Apply -- names the exact hand edit and the compile that has to follow it.
 */
export function Rebind({
  pack,
  verb,
  slot,
  composition,
  onOpenManifest,
  onCopy,
  onClose,
}: RebindProps) {
  const { text } = useSchemeColors();

  const verbEntry = composition.verbs.find(v => v.name === verb);
  const slotEntry = verbEntry?.slots.find(s => s.name === slot);
  const currentBinding = slotEntry?.boundTo ?? null;
  const selfRef = verbEntry?.engineRef ?? null;

  const candidates = useMemo(
    () => composition.fills.filter(f => f.binding !== currentBinding),
    [composition.fills, currentBinding]
  );

  const [target, setTarget] = useState<string | null>(
    candidates[0]?.binding ?? null
  );
  const [confirmed, setConfirmed] = useState(false);

  // The full `composition` goes straight to `invertBindings` -- the same
  // inversion `InverseIndex` renders. A roster-only reconstruction here
  // would undercount: the roster is a fraction of the manifest's binding
  // keys, and a fill bound only by a stage would wrongly read "nothing else
  // binds it."
  const bindingSites = useMemo(
    () => invertBindings(composition),
    [composition]
  );

  function otherSites(binding: string | null): BindingSite[] {
    if (!binding) return [];
    return (bindingSites[binding] ?? []).filter(
      site => !(site.ref === selfRef && site.slot === slot)
    );
  }

  const outgoingSites = otherSites(currentBinding);
  const incomingSites = otherSites(target);

  // `manifestPath` is optional on the wire (an rt older than the field
  // answers without it) and nullable (a rosterless pack). Both collapse to
  // "nothing to show" -- never a guessed path.
  const manifestPath = composition.manifestPath ?? null;
  const bindingsKey = `bindings.${verb}.${slot}`;
  const compileCommand = `rt skills compile --pack ${pack} --verb ${verb}`;
  const editText = manifestPath
    ? `${manifestPath}\n  ${bindingsKey}\n    "${currentBinding ?? ''}"\n  → "${target ?? ''}"\n\n${compileCommand}`
    : `${bindingsKey}\n    "${currentBinding ?? ''}"\n  → "${target ?? ''}"\n\n${compileCommand}`;

  return (
    <Stack gap="md" data-testid="rebind">
      <Group
        wrap="nowrap"
        justify="space-between"
        pb="sm"
        style={{ borderBottom: `1px solid ${SOFT_RULE}` }}
      >
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text fw={700} size="lg">
              Rebind
            </Text>
            <Text size="sm" c={text.muted} truncate>
              {verb} · slot {slot}
            </Text>
          </Group>
        </Stack>
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={onClose}
          aria-label="Close"
        >
          <Icons.close size={16} />
        </ActionIcon>
      </Group>

      <Stack gap={4}>
        <Text size="xs" c={text.muted}>
          Bind this slot to
        </Text>
        {candidates.length === 0 ? (
          <Paper
            radius="sm"
            p="sm"
            style={{ border: `1px solid ${SOFT_RULE}` }}
          >
            <Text size="xs" c={text.muted}>
              No other fill in this pack to rebind {slot} to.
            </Text>
          </Paper>
        ) : (
          <Paper
            radius="sm"
            p="sm"
            style={{ border: `1px solid ${SOFT_RULE}` }}
          >
            <Group gap="xs" wrap="nowrap" align="center">
              <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                {currentBinding}
              </Text>
              <Icons.arrowRight size={14} color={text.muted} />
              <Select
                size="xs"
                w={260}
                data={candidates.map(c => ({
                  value: c.binding,
                  label: c.binding,
                }))}
                value={target}
                onChange={setTarget}
                allowDeselect={false}
                aria-label="rebind target fill"
              />
            </Group>
          </Paper>
        )}
        <Group justify="flex-end">
          <Button size="xs" onClick={() => setConfirmed(true)}>
            Rebind
          </Button>
        </Group>
      </Stack>

      {confirmed && (
        <Stack gap="md" data-testid="rebind-confirm">
          <BlastRadius
            dotColor="var(--mantine-color-warn-6, orange)"
            headline={`Unbinding ${currentBinding ?? 'nothing'}`}
            note={`It stays bound everywhere below. This change touches only ${verb}'s slot.`}
            sites={outgoingSites}
            emptyText={`Nothing else binds ${currentBinding} — ${verb} was its only site.`}
          />

          {target && (
            <BlastRadius
              dotColor="var(--mantine-color-ok-6, green)"
              headline={`Binding ${target}`}
              sites={incomingSites}
              emptyText={`Nothing else binds this fill yet — ${verb} would be its first site.`}
            />
          )}

          {target && (
            <Stack
              gap={6}
              pt="sm"
              style={{ borderTop: `1px solid ${SOFT_RULE}` }}
              data-testid="manifest-edit"
            >
              <Group gap={6} wrap="nowrap">
                <Icons.edit size={14} color={text.muted} />
                <Text size="sm" fw={600}>
                  Make this edit by hand
                </Text>
              </Group>
              <Text size="xs" c={text.muted}>
                rt has no verb that writes a binding yet, so the console does
                not write one either.
                {manifestPath
                  ? ' Edit the manifest, then recompile:'
                  : ' Recompile after making the edit below:'}
              </Text>
              {!manifestPath && (
                <Text size="xs" c={text.muted}>
                  Manifest path not available — this rt has not reported one for{' '}
                  {pack}.
                </Text>
              )}
              <Paper
                radius="sm"
                p="xs"
                style={{ border: `1px solid ${SOFT_RULE}` }}
              >
                <Text
                  size="xs"
                  ff="monospace"
                  style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {editText}
                </Text>
              </Paper>
              <Group gap={6} justify="flex-end">
                <Button
                  size="xs"
                  variant="default"
                  disabled={!manifestPath}
                  onClick={() => manifestPath && onOpenManifest?.(manifestPath)}
                >
                  Open manifest
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  disabled={!manifestPath}
                  onClick={() => manifestPath && onCopy?.(editText)}
                >
                  Copy
                </Button>
              </Group>
            </Stack>
          )}
        </Stack>
      )}
    </Stack>
  );
}
