import { useMemo } from 'react';

import { Code, Group, Paper, Stack, Text } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import type { SlotOutlineNode } from './outline';
import { splitCompiledBody, type Seam } from './parseSeam';
import { QuietBadge } from './QuietBadge';
import { SOFT_RULE } from './SlotRow';

/** Matches the slot column on the spine, so a reader moving from the map to
    this pane reads the same names in the same place. */
const NAME_WIDTH = 104;

function spanOf(seam: Seam): string {
  return `${seam.path}:${seam.lines[0]}-${seam.lines[1]}`;
}

/** Matches every other code surface in the console rather than Code's own
    default block padding and size. */
const CODE_STYLE = {
  padding: 0,
  background: 'transparent',
  fontSize: 'var(--mantine-font-size-xs)',
  lineHeight: 1.65,
  // Compiled SKILL.md carries long frontmatter lines; wrapping them keeps the
  // drawer's only scroll vertical.
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;

/**
 * What a slot contributed to this body, said from the COMPOSITION rather than
 * from the seams.
 *
 * The compiler inlines a fill only when it is unregistered or still
 * surface-internal; a registered, public fill is compiled to a reference and
 * leaves no seam at all. A pane built from seams alone therefore omits
 * exactly the fills that are public and reusable, and omits them silently.
 */
function slotContribution(
  slot: SlotOutlineNode,
  seam: Seam | undefined
): string {
  if (slot.inlined === true) {
    return seam
      ? spanOf(seam)
      : 'inlined, but no seam for it in this body — rt and the compiled text disagree';
  }
  if (slot.inlined === false) {
    return 'invoked as its own skill; its body is not copied in here';
  }
  return slot.boundTo
    ? 'bound outside the roster; rt states no inline flag for it'
    : 'nothing bound, so nothing to compile in';
}

function contributionLabel(slot: SlotOutlineNode): string {
  if (slot.inlined === true) return 'inlined';
  if (slot.inlined === false) return 'referenced';
  return 'not in this body';
}

/**
 * Every slot the verb declares and what became of it. The seams say where
 * text came from; this says what exists — the two answer different questions,
 * and only this one can mention a fill the compiled body never names.
 */
function SlotContributions({
  slots,
  seamsBySlot,
}: {
  slots: SlotOutlineNode[];
  seamsBySlot: Map<string, Seam>;
}) {
  const { bg, text } = useSchemeColors();

  if (slots.length === 0) return null;

  return (
    <Stack gap="xs" data-testid="compiled-slots">
      <Text size="xs" c={text.muted}>
        Slots
      </Text>
      <Paper
        bg={bg.level3}
        radius="sm"
        style={{ border: `1px solid ${SOFT_RULE}` }}
      >
        {slots.map((slot, i) => (
          <Group
            key={slot.name}
            gap="md"
            wrap="nowrap"
            px="md"
            py={5}
            style={
              i === 0 ? undefined : { borderTop: `1px solid ${SOFT_RULE}` }
            }
            data-testid={`compiled-slot-${slot.name}`}
          >
            <Text size="sm" fw={600} w={NAME_WIDTH} style={{ flex: 'none' }}>
              {slot.name}
            </Text>
            <QuietBadge>{contributionLabel(slot)}</QuietBadge>
            <Text size="xs" c={text.muted} truncate style={{ flex: 1 }}>
              {slotContribution(slot, seamsBySlot.get(slot.name))}
            </Text>
          </Group>
        ))}
      </Paper>
    </Stack>
  );
}

/** A section's provenance, drawn as a heading instead of left in the text as
    the HTML comment rt wrote. */
function SeamHeading({ seam }: { seam: Seam }) {
  const { text } = useSchemeColors();

  return (
    <Group gap="xs" wrap="nowrap" data-testid="seam-heading">
      <Text size="xs" c={text.muted} style={{ flex: 'none' }}>
        {seam.kind === 'step' ? 'step' : `${seam.kind} ${seam.slot}`}
      </Text>
      <Text size="sm" fw={600} style={{ flex: 'none' }}>
        {seam.ref}
      </Text>
      <QuietBadge>{seam.version}</QuietBadge>
      <Text size="xs" c={text.dimmed} truncate style={{ flex: 1 }}>
        {spanOf(seam)}
      </Text>
    </Group>
  );
}

export interface CompiledViewProps {
  /** The body `rt skills compile --preview` printed, verbatim. */
  body: string;
  /** The verb's slots, from the composition payload. */
  slots: SlotOutlineNode[];
}

/**
 * The compiled body with its seams read as structure: each part under a
 * heading naming the source, version and line span it came from, and the
 * seam comments themselves gone from the text.
 *
 * This is still one artifact's text, shown whole and in order — the sections
 * are how it was assembled, not a comparison with anything. Nothing here may
 * read as a diff against the file on disk; the drawer above says in words
 * that it is not one.
 */
export function CompiledView({ body, slots }: CompiledViewProps) {
  const { bg } = useSchemeColors();
  const sections = useMemo(() => splitCompiledBody(body), [body]);
  const seamsBySlot = useMemo(() => {
    const map = new Map<string, Seam>();
    for (const { seam } of sections) {
      // First fragment wins: a slot part can be SPLIT by an include part
      // (compile-native contract), and the contribution row names where the
      // slot's text begins, not where its last fragment happens to sit.
      if (seam?.kind === 'slot' && seam.slot && !map.has(seam.slot))
        map.set(seam.slot, seam);
    }
    return map;
  }, [sections]);

  return (
    <Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
      <SlotContributions slots={slots} seamsBySlot={seamsBySlot} />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          background: bg.level3,
          border: `1px solid ${SOFT_RULE}`,
          borderRadius: 4,
          padding: 'var(--mantine-spacing-md)',
        }}
        data-testid="compile-preview-body"
      >
        <Stack gap="md">
          {sections.map((section, i) => (
            <Stack
              gap={4}
              // The span disambiguates: one ref can legally appear twice
              // (an attachment split around a slot, a slot split by an
              // include), and kind:ref alone would collide those keys.
              key={
                section.seam
                  ? `${section.seam.kind}:${section.seam.ref}:${section.seam.lines[0]}`
                  : i
              }
              data-testid={
                section.seam
                  ? `compiled-section-${section.seam.slot ?? 'step'}`
                  : 'compiled-preamble'
              }
            >
              {section.seam && <SeamHeading seam={section.seam} />}
              <Code block style={CODE_STYLE}>
                {section.text}
              </Code>
            </Stack>
          ))}
        </Stack>
      </div>
    </Stack>
  );
}
