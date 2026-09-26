import { ActionIcon, Box, Menu } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import { ScopeDot } from './ScopeBadge';
import { useSettingsRepo } from './useConsoleSettings';
import type { useRowSave } from './useRowSave';
import {
  APPROVAL_KEY,
  isRung,
  isStoreScope,
  layerLabel,
  rungBase,
  type LayerScope,
  type StoreScope,
} from './view';

const SLOT = 28;

/** Move and remove for the layer a writable row's value comes from, plus an
    Edit as JSON entry for a composite row when one is offered. Rows with
    nothing stored, no move/remove and no JSON entry keep an empty slot so
    every chevron lines up. */
export function RowMenu({
  def,
  row,
  onEditJson,
}: {
  def: SettingDefWire;
  row: ReturnType<typeof useRowSave>;
  onEditJson?: () => void;
}) {
  const { text } = useSchemeColors();
  const repo = useSettingsRepo();
  const from = def.effective.scope;
  const base = rungBase(from);
  const stored =
    def.key !== APPROVAL_KEY &&
    Boolean(def.writable && base && def.scopes.includes(base));
  if (!stored && !onEditJson) return <Box w={SLOT} />;
  // A move re-sets the value at its target, which rejects what rt already
  // refused here; removing it still works. settings-kit's move reads and
  // writes global layers only, so a repo rung offers removal alone.
  const moveTo =
    stored && def.effective.invalid === undefined && !isRung(from)
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
        {onEditJson && (
          <Menu.Item
            leftSection={<Icons.edit size={14} />}
            onClick={onEditJson}
          >
            Edit as JSON
          </Menu.Item>
        )}
        {onEditJson && stored && <Menu.Divider />}
        {stored && (
          <>
            {moveTo.map(to => (
              <Menu.Item
                key={to}
                leftSection={<ScopeDot scope={to} />}
                onClick={() => void row.move(from!, to)}
              >
                {`Move to ${to}`}
              </Menu.Item>
            ))}
            {moveTo.length > 0 && <Menu.Divider />}
            <Menu.Item
              c="var(--tk-text-bad)"
              leftSection={<Icons.trash size={14} />}
              onClick={() => void row.clear(from!)}
            >
              {`Remove from ${layerLabel(from as LayerScope)}${
                repo && def.repoScoped && isStoreScope(from)
                  ? ' (all repos)'
                  : ''
              }`}
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
