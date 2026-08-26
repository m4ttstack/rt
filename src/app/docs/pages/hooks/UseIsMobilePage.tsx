import { Badge, Group, Stack, Text } from '@ui/core';
import { useIsMobile, useViewportSize } from '@ui/hooks';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { useIsMobile } from '@ui/hooks';",
  '',
  'const isMobile = useIsMobile();',
  '',
  'return isMobile ? <Drawer {...drawerProps} /> : <Sidebar />;',
].join('\n');

// Rows transcribed from src/ui/hooks/useIsMobile.ts.
const API_ROWS = [
  {
    name: 'useIsMobile()',
    type: '() => boolean',
    note: "True once the viewport has been measured and its width is at or below the theme's sm breakpoint. No options: the breakpoint comes from the design system, not a per-call pixel value.",
  },
];

function UseIsMobileDemo() {
  const isMobile = useIsMobile();
  const { width } = useViewportSize();

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          viewport width:
        </Text>
        <Badge variant="light">{width}px</Badge>
        <Text size="sm" c="dimmed">
          useIsMobile():
        </Text>
        <Badge variant="light" color={isMobile ? 'orange' : 'green'}>
          {String(isMobile)}
        </Badge>
      </Group>
      <Text size="sm" c="dimmed">
        Resize the window (or open device emulation) across the sm breakpoint
        and watch it flip live.
      </Text>
    </Stack>
  );
}

export function UseIsMobilePage() {
  return (
    <ComponentDoc
      title="useIsMobile"
      lead="True once the viewport is measured and at or below the theme's sm breakpoint -- the kit's one 'is this mobile?' answer, tracking whatever the design system defines rather than a hard-coded pixel value."
      demoIntro="The live values for this window; drag it narrower than the sm breakpoint and the flag flips."
      demo={<UseIsMobileDemo />}
      usage={USAGE}
      usageMinHeight={150}
      propsTables={[{ title: 'API', rows: API_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          Built on Mantine&apos;s useViewportSize against theme.breakpoints.sm,
          so re-theming the breakpoints moves the answer everywhere at once.
          useViewportSize reports 0x0 until its mount effect measures the
          window; the width &gt; 0 guard keeps that unmeasured first beat from
          being treated as mobile (so the hook is false, not true, before
          measurement). The kit&apos;s own responsive components
          (PageShell&apos;s overlay drawer, useRailState&apos;s mobile behavior)
          key off this same hook.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
