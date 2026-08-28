import { ActionIcon, Group, Text, Tooltip } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';

import type { IncludeOutlineNode } from './outline';
import { QuietBadge } from './QuietBadge';

/** Wider than a slot's name column: include names are compound
    (`review-dispatch-body-after`) where slot names are one word. */
const NAME_WIDTH = 208;

/**
 * One `{{include:...}}`: the attachment's name and the mattstack ref the
 * compiler inlines there. No rebind, no sites chip -- an include is the
 * author's fixed choice, not a binding the pack made, so neither action
 * applies. The link opens the attachment's own SKILL.md, the same way the
 * header's Open source opens the verb's.
 */
export function IncludeRow({ include }: { include: IncludeOutlineNode }) {
  const { text } = useSchemeColors();

  return (
    <Group
      gap="md"
      wrap="nowrap"
      px="md"
      py={5}
      style={{ minWidth: 0 }}
      data-testid={`include-${include.name}`}
    >
      <Text size="sm" fw={600} w={NAME_WIDTH} truncate style={{ flex: 'none' }}>
        {include.name}
      </Text>
      <Icons.arrowRight size={12} color={text.muted} />
      <Text size="sm" c={text.muted} truncate style={{ flex: 1, minWidth: 0 }}>
        {include.ref}
      </Text>
      <QuietBadge>author-fixed</QuietBadge>
      {include.sourcePath && (
        <Tooltip label="Open source">
          <ActionIcon
            component="a"
            href={`vscode://file${include.sourcePath}`}
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={`open ${include.name} source`}
            data-testid="open-include-source"
            style={{ flex: 'none' }}
          >
            <Icons.edit size={12} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}
