import {
  Anchor,
  Badge,
  Group,
  Paper,
  Stack,
  Text,
  UnstyledButton,
} from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import type { SlotOutlineNode } from './outline';
import { QuietBadge } from './QuietBadge';

/** tokyo-theme.css re-points Mantine's `gray-3` at `--tk-border-soft`, the
    palette's rule-inside-a-surface weight. The slot table is that case: a
    grid drawn inside a card, not another card. */
export const SOFT_RULE = 'var(--mantine-color-gray-3)';

/** Fixed columns, so slot names and contracts line up down the whole spine
    instead of jittering with each row's content. */
const NAME_WIDTH = 104;
const CONTRACT_WIDTH = 176;

/**
 * The fill is the way into the inverse index, on every bound slot rather
 * than only the ones carrying a `N sites` chip. The chip counts; it is not
 * the door. The fills that most need checking before a delete are the ones
 * bound in exactly one place, and those never carry a chip at all.
 *
 * A `boundTo` with no fill behind it opens the index too -- "what else
 * points at this dangling ref" is the same question -- but stays muted so it
 * never reads as a healthy binding.
 */
function FillLink({
  slot,
  onShowSites,
}: {
  slot: SlotOutlineNode;
  onShowSites: (binding: string) => void;
}) {
  const { text } = useSchemeColors();
  const boundTo = slot.boundTo;

  if (!boundTo) {
    return (
      <Text size="sm" c={text.dimmed} style={{ flex: 1, minWidth: 0 }}>
        nothing bound
      </Text>
    );
  }

  return (
    <Anchor
      component="button"
      type="button"
      onClick={() => onShowSites(boundTo)}
      size="sm"
      truncate
      c={slot.fill ? undefined : text.muted}
      aria-label={`what binds ${boundTo}`}
      style={{
        flex: 1,
        minWidth: 0,
        // Mantine's Anchor is styled for an <a>; as a <button> the
        // user-agent chrome has to be cleared or the row grows a bevel.
        background: 'none',
        border: 0,
        padding: 0,
        textAlign: 'left',
        cursor: 'pointer',
      }}
      data-testid="slot-fill"
    >
      {slot.fill ? boundTo : `${boundTo} — no matching fill in this pack`}
    </Anchor>
  );
}

/**
 * One binding: the slot, the contract it answers to, and the fill wired into
 * it. Never behind a chevron -- verb → slot → fill IS the wiring, so it is
 * the thing the page shows rather than the thing it hides.
 *
 * `optional` is stated only where it changes the reading -- an EMPTY optional
 * slot, which is a choice rather than the error an empty required slot is.
 * Badging every optional slot would put a badge on nearly every row of the
 * live pack and say nothing.
 */
export function SlotRow({
  slot,
  onShowSites,
}: {
  slot: SlotOutlineNode;
  onShowSites: (binding: string) => void;
}) {
  const { text } = useSchemeColors();
  const unbound = !slot.boundTo;

  return (
    <Stack gap={2} px="md" py={5} data-testid={`slot-${slot.name}`}>
      <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
        <Text size="sm" fw={600} w={NAME_WIDTH} style={{ flex: 'none' }}>
          {slot.name}
        </Text>
        <Text
          size="xs"
          c={text.muted}
          w={CONTRACT_WIDTH}
          truncate
          style={{ flex: 'none' }}
        >
          {slot.contract ?? 'contract unknown'}
        </Text>
        <Icons.arrowRight size={12} color={text.muted} />
        <FillLink slot={slot} onShowSites={onShowSites} />
        {unbound && slot.required === false && (
          <QuietBadge>optional</QuietBadge>
        )}
        {unbound && slot.required === true && (
          <Badge size="xs" variant="light" color="bad">
            required, unbound
          </Badge>
        )}
        {slot.siteCount > 1 && slot.boundTo && (
          <UnstyledButton
            onClick={() => onShowSites(slot.boundTo as string)}
            aria-label={`what binds ${slot.boundTo}`}
            data-testid="slot-sites"
          >
            <QuietBadge>{slot.siteCount} sites</QuietBadge>
          </UnstyledButton>
        )}
      </Group>
      {slot.resolveError && (
        <Text
          size="xs"
          c={text.highContrast('bad')}
          data-testid="slot-resolve-error"
        >
          {slot.resolveError}
        </Text>
      )}
    </Stack>
  );
}

/** The nested surface holding a skill's slots. Rendered even for one slot:
    the alignment is what makes a column of skills readable as one wiring. */
export function SlotTable({
  slots,
  onShowSites,
}: {
  slots: SlotOutlineNode[];
  onShowSites: (binding: string) => void;
}) {
  const { bg } = useSchemeColors();

  if (slots.length === 0) return null;

  return (
    <Paper
      bg={bg.level3}
      mt="xs"
      radius="sm"
      style={{ border: `1px solid ${SOFT_RULE}` }}
      data-testid="slot-table"
    >
      {slots.map((slot, i) => (
        <div
          key={`${slot.name}-${slot.boundTo ?? i}`}
          style={i === 0 ? undefined : { borderTop: `1px solid ${SOFT_RULE}` }}
        >
          <SlotRow slot={slot} onShowSites={onShowSites} />
        </div>
      ))}
    </Paper>
  );
}
