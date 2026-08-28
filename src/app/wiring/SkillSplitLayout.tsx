import type { ReactNode } from 'react';

import { Paper } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import type { BindingSite, SkillsComposition } from './outline';
import { SkillDetailPanel } from './SkillDetailPanel';
import type { SkillSelection } from './useSkillSelection';

export interface SkillSplitLayoutProps {
  pack: string;
  composition: SkillsComposition;
  bindingSites: Record<string, BindingSite[]>;
  asOf?: number;
  selection: SkillSelection;
  /** The Paper's own body -- the caller's spine/list content. Padding and
      width follow `selection.panelOpen` the same way in every caller, so
      only the content inside is the caller's own. */
  left: ReactNode;
  /** Defaults match `WiringSpineView`'s pre-extraction testids, so the
      Pipeline tab's existing tests need no changes. */
  splitTestId?: string;
  paperTestId?: string;
}

/**
 * The split view's right half, shared by `WiringSpineView` and
 * `OnDemandView`: the flex ratio between the (optionally condensed) left
 * column and the detail panel, and the full `SkillDetailPanel` wiring so a
 * fix to one of its callbacks lands for both views at once.
 */
export function SkillSplitLayout({
  pack,
  composition,
  bindingSites,
  asOf,
  selection,
  left,
  splitTestId = 'wiring-split',
  paperTestId = 'wiring-spine',
}: SkillSplitLayoutProps) {
  const { bg, border } = useSchemeColors();
  const {
    selectedEntry,
    panelOpen,
    setSelectedKey,
    showInMap,
    copyAgentContext,
  } = selection;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        // Detail.dc.html: 18px gutter between the spine and the panel (= xxl).
        gap: 'var(--mantine-spacing-xxl)',
      }}
      data-testid={splitTestId}
    >
      <Paper
        bg={bg.level2}
        p={panelOpen ? 'md' : 'xl'}
        radius="xl"
        style={{
          // Detail.dc.html: the condensed left column is a fixed 400px rail
          // once the panel is open; full-width otherwise.
          flex: panelOpen ? '0 0 400px' : '1 1 0',
          minWidth: 0,
          border: `1px solid ${border.default}`,
        }}
        data-testid={paperTestId}
      >
        {left}
      </Paper>

      {selectedEntry && (
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <SkillDetailPanel
            key={selectedEntry.key}
            pack={pack}
            entry={selectedEntry}
            composition={composition}
            bindingSites={bindingSites}
            asOf={asOf}
            onClose={() => setSelectedKey(null)}
            onCopyContext={() => void copyAgentContext(selectedEntry)}
            onShowInMap={showInMap}
          />
        </div>
      )}
    </div>
  );
}
