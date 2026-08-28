import { useMemo, useState } from 'react';

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
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
  /** Fired with the chosen fill when Apply is pressed. `Rebind` never writes
      anything itself -- the caller owns the `rt skills bind` mutation and
      passes `applying`/`applyError` back in from it. */
  onApply?: (fill: string) => void;
  /** True while the caller's apply is in flight -- disables Discard and
      Apply so a second click cannot start a second, concurrent bind. */
  applying?: boolean;
  /** Set by the caller after a failed apply (a non-zero `rt skills bind`,
      say), so the panel can say what went wrong. */
  applyError?: string | null;
  onClose?: () => void;
}

/**
 * The staged rebind and its blast radius, then a real staged Apply: nothing
 * writes until Apply is pressed, and the panel names the exact `rt skills
 * bind` command it will run rather than describing one for a person to type.
 */
export function Rebind({
  pack,
  verb,
  slot,
  composition,
  onApply,
  applying = false,
  applyError = null,
  onClose,
}: RebindProps) {
  const { bg, text } = useSchemeColors();

  const verbEntry = composition.verbs.find(v => v.name === verb);
  const slotEntry = verbEntry?.slots.find(s => s.name === slot);
  const currentBinding = slotEntry?.boundTo ?? null;
  const contract = slotEntry?.contract ?? null;
  const selfRef = verbEntry?.engineRef ?? null;

  // Only a fill whose `provides` matches the slot's own `contract` is a
  // legal target -- offering anything else would let Apply stage a bind rt
  // itself will 502 on.
  const candidates = useMemo(
    () =>
      composition.fills.filter(
        f => f.binding !== currentBinding && f.provides === contract
      ),
    [composition.fills, currentBinding, contract]
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
  // "nothing to show" -- never a guessed path; the command itself does not
  // need it, `rt skills bind` resolves the manifest on its own.
  const manifestPath = composition.manifestPath ?? null;
  const bindingsKey = `bindings.${verb}.${slot}`;
  const bindCommand = target
    ? `rt skills bind ${verb} ${slot} ${target} --pack ${pack}`
    : null;
  const bindCaption = manifestPath
    ? `writes ${bindingsKey} in ${manifestPath}, then recompiles ${verb}`
    : `writes ${bindingsKey}, then recompiles ${verb}`;

  function discard() {
    setConfirmed(false);
    setTarget(candidates[0]?.binding ?? null);
  }

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

          {target && bindCommand && (
            <Stack
              gap={6}
              pt="sm"
              style={{ borderTop: `1px solid ${SOFT_RULE}` }}
              data-testid="rebind-apply"
            >
              <Group gap={6} wrap="nowrap">
                <Icons.checkCircle size={14} color={text.muted} />
                <Text size="sm" fw={600}>
                  1 change staged — nothing is written until you apply
                </Text>
              </Group>
              <Paper
                bg={bg.level1}
                radius="sm"
                p="xs"
                style={{ border: `1px solid ${SOFT_RULE}` }}
              >
                <Text
                  size="xs"
                  ff="monospace"
                  style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {bindCommand}
                </Text>
              </Paper>
              <Text size="xs" c={text.muted} truncate>
                {bindCaption}
              </Text>
              {applyError && (
                <Alert
                  variant="light"
                  color="bad"
                  icon={<Icons.error size={14} />}
                >
                  <Text size="xs">{applyError}</Text>
                </Alert>
              )}
              <Group gap={6} justify="flex-end">
                <Button
                  size="xs"
                  variant="default"
                  disabled={applying}
                  onClick={discard}
                >
                  Discard
                </Button>
                <Button
                  size="xs"
                  disabled={applying}
                  loading={applying}
                  onClick={() => onApply?.(target)}
                >
                  Apply
                </Button>
              </Group>
            </Stack>
          )}
        </Stack>
      )}
    </Stack>
  );
}
