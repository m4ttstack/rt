import { useSchemeColors } from '@ui/hooks';

/**
 * The panel surface both of this surface's drawers are drawn on.
 *
 * Mantine paints a drawer with `--mantine-color-body` -- the PAGE colour --
 * and `tokyo-theme.css` documents why the theme cannot repoint that token
 * without repainting every Modal, Popover and Drawer in the app. The
 * artboards put the drawer on the panel surface instead, so it is set here,
 * per component, where it is a local decision rather than a theme change.
 *
 * Shared rather than copied: two drawers on one surface sitting on two
 * different colours is a worse defect than either colour alone.
 */
export function useDrawerSurface() {
  const { bg, border } = useSchemeColors();
  const surface = { background: bg.level2 };

  return {
    content: { ...surface, borderLeft: `1px solid ${border.default}` },
    header: { ...surface, borderBottom: `1px solid ${border.default}` },
  };
}
