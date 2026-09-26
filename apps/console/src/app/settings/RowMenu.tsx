import { ActionIcon, Box, Menu } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import { ScopeDot } from './ScopeBadge';
import type { useRowSave } from './useRowSave';
import { isStoreScope, type StoreScope } from './view';

const SLOT = 28;

/** Move and remove for the layer a writable row's value comes from. Rows
    with nothing stored, or stored where the key no longer allows, keep an
    empty slot so every chevron lines up. */
export function RowMenu({
  def,
  row,
}: {
  def: SettingDefWire;
  row: ReturnType<typeof useRowSave>;
}) {
  const { text } = useSchemeColors();
  const from = def.effective.scope;
  if (!def.writable || !isStoreScope(from) || !def.scopes.includes(from))
    return <Box w={SLOT} />;
  // A move re-sets the value at its target, which rejects what rt already
  // refused here; removing it still works.
  const moveTo =
    def.effective.invalid === undefined
      ? (def.scopes as StoreScope[]).filter(s => s !== from && isStoreScope(s))
      : [];
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          c={text.muted}
          aria-label={`${def.key} actions`}
        >
          <Icons.moreHorizontal size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {moveTo.map(to => (
          <Menu.Item
            key={to}
            leftSection={<ScopeDot scope={to} />}
            onClick={() => void row.move(from, to)}
          >
            {`Move to ${to}`}
          </Menu.Item>
        ))}
        {moveTo.length > 0 && <Menu.Divider />}
        <Menu.Item
          c="var(--tk-text-bad)"
          leftSection={<Icons.trash size={14} />}
          onClick={() => void row.clear(from)}
        >
          {`Remove from ${from}`}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
