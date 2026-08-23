import { useState } from 'react';

import {
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  NavLink,
  PageShell,
  Stack,
  Text,
} from '@ui/core';
import { notifications } from '@ui/notifications';
import { PAGE_SHELL_DEMO_PATH } from '../../../demo/paths';
import { Link } from '../../../router/Link';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { PageShell } from '@ui/core';",
  '',
  '// Compound form: compose the statics. Sub-components register their',
  '// presence, so Main narrows for a mounted Sidebar and Content subtracts',
  '// a mounted Header from its height math.',
  '<PageShell drawerStateKey="gear-sidebar">',
  '  <PageShell.Sidebar>{sidebarNav}</PageShell.Sidebar>',
  '  <PageShell.Main>',
  '    <PageShell.Header title="Gear library" actions={<Button>Add</Button>} />',
  '    <PageShell.Content>{page}</PageShell.Content>',
  '  </PageShell.Main>',
  '</PageShell>;',
  '',
  '// Simple form: no compound children, classic title-row-above-content.',
  '<PageShell title="Settings" actions={<Button>Save</Button>}>',
  '  {page}',
  '</PageShell>;',
].join('\n');

// Rows transcribed from src/ui/core/page-shell/PageShell.tsx (PageShellProps).
const ROOT_ROWS = [
  {
    name: 'headerHeight?',
    type: 'string | number',
    note: 'Height of PageShell.Header, when one is rendered. Default 64.',
  },
  {
    name: 'sidebarWidth?',
    type: 'string | number',
    note: "Open width of PageShell.Sidebar. Default '20vw'.",
  },
  {
    name: 'sideBarHeaderBg?',
    type: "BoxProps['bg']",
    note: 'Override for the shared surface PageShell.Sidebar and PageShell.Header sit on. Default bg.level2.',
  },
  {
    name: 'scrollClamp?',
    type: 'boolean',
    note: 'false (default): the content area gets its own capped scroll frame. true: a fixed, overflow-hidden height for layouts that manage their own inner scrolling.',
  },
  {
    name: 'drawerStateKey?',
    type: 'string',
    note: "localStorage key persisting the sidebar's open/collapsed state across visits; plain component state without it.",
  },
  {
    name: 'heightMode?',
    type: "'100vh' | '100%' | 'auto'",
    note: "What 'full height' means for the height math: the viewport (default), the parent container, or no clamping at all.",
  },
  {
    name: 'topOffset?',
    type: 'string | number',
    note: "Extra top offset to clear a fixed app-level header rendered outside this component. Inside a RailShell it defaults to that chrome's headerHeight (the double-nav case, so pass nothing); elsewhere it defaults to 0. An explicit value always wins.",
  },
  {
    name: 'fixedHeader?',
    type: 'boolean',
    note: 'Renders the header position: fixed (overlaying instead of stacking, so it stops subtracting from the content height). Default false.',
  },
  {
    name: 'title? / actions? / topNotch?',
    type: 'simple mode',
    note: 'With no compound children, these render the classic page: an auto Header from title/actions, and the topNotch banner slot on the auto Content.',
  },
  {
    name: 'tabs?',
    type: 'PageShellTab[]',
    note: 'Tab row above the body row (sidebar included) -- page-level sub-navigation. The content/sidebar height math subtracts the bar automatically.',
  },
  {
    name: 'tabBarHeight?',
    type: 'string | number',
    note: 'Height of the tab bar when tabs is set. Default PAGE_SHELL_TAB_BAR_HEIGHT (46).',
  },
];

// Rows transcribed from src/ui/core/page-shell/components/Sidebar.tsx.
const SIDEBAR_ROWS = [
  {
    name: 'children',
    type: 'ReactNode | (height) => ReactNode',
    note: 'Content, or a render prop receiving the computed available height.',
  },
  {
    name: 'bg?',
    type: "BoxProps['bg']",
    note: "Surface override; defaults to the shell's shared bg.level2 surface.",
  },
  {
    name: 'scrollAreaProps?',
    type: 'ScrollAreaAutosizeProps',
    note: "Extra props for the sidebar's inner ScrollArea (desktop rail only).",
  },
  {
    name: 'drawerProps?',
    type: 'DrawerProps subset',
    note: 'Extra props for the mobile overlay drawer.',
  },
  {
    name: 'hideCollapseButton?',
    type: 'boolean',
    note: "Hides the floating collapse control on the rail's edge. Default false.",
  },
];

// Rows transcribed from src/ui/core/page-shell/components/Header.tsx.
const HEADER_ROWS = [
  {
    name: 'title?',
    type: 'ReactNode',
    note: 'Left-aligned page title, rendered as a Title order 2.',
  },
  {
    name: 'actions?',
    type: 'ReactNode',
    note: 'Right-aligned actions cluster (buttons, toggles, ...).',
  },
  {
    name: 'children?',
    type: 'ReactNode',
    note: 'Free-form header content, rendered between title and actions.',
  },
  {
    name: 'withBorder?',
    type: 'boolean',
    note: 'Bottom hairline. Default true.',
  },
  {
    name: '...rest',
    type: 'GroupProps',
    note: "Passthrough to the header row Group (bg overrides the shell's shared surface).",
  },
];

// Rows transcribed from src/ui/core/page-shell/components/Content.tsx.
const CONTENT_ROWS = [
  {
    name: 'children',
    type: 'ReactNode | (height) => ReactNode',
    note: 'Content, or a render prop receiving the computed available height (pair with scrollClamp to size inner frames).',
  },
  {
    name: 'bg?',
    type: "FlexProps['bg']",
    note: 'Surface override. Default bg.level3.',
  },
  {
    name: 'contentContainer?',
    type: 'boolean',
    note: "Wraps children in the kit's ContentContainer (capped, centered column). Defaults on in scroll mode, off under scrollClamp; set it explicitly to override. contentContainerProps customizes it.",
  },
  {
    name: 'scrollAreaProps?',
    type: 'ScrollAreaAutosizeProps',
    note: 'Extra props for the outer ScrollArea (scroll mode only).',
  },
  {
    name: 'topNotch?',
    type: '{ content, opened }',
    note: 'Banner slot docked at the top of the content area -- pair with Notch. Stays mounted while closed; the wrapper animates its height so the banner slides away.',
  },
];

// Rows transcribed from src/ui/core/page-shell/components/TabBar.tsx
// (PageShellTab).
const TAB_ROWS = [
  {
    name: 'id',
    type: 'string',
    note: 'Required. Stable identity for the tab.',
  },
  {
    name: 'label',
    type: 'ReactNode',
    note: 'Required. Tab text; a plain string is typical.',
  },
  {
    name: 'labelComponent?',
    type: 'ReactNode',
    note: 'Custom label node rendered instead of label -- for tabs needing more than plain text (a badge, a truncating tooltip, ...).',
  },
  {
    name: 'icon?',
    type: 'IconName',
    note: 'Optional icon rendered before the label.',
  },
  {
    name: 'iconRight?',
    type: 'IconName',
    note: 'Optional icon rendered after the label.',
  },
  { name: 'active?', type: 'boolean', note: 'Highlights the active tab.' },
  {
    name: 'onClick?',
    type: '() => void',
    note: 'Called on click (alongside any linking the tab carries).',
  },
  {
    name: 'component? / href?',
    type: 'polymorphic',
    note: 'Router-agnostic linking, same idea as RailEntry (typed-router caveat: AGENTS.md section 10).',
  },
];

// Rows transcribed from the TabBar component's own props
// (PageShellTabBarProps) -- passthrough to the underlying Mantine `Tabs`,
// beyond the `tabs` array itself. Only reachable when composing TabBar
// directly (the root's `tabs` shorthand only threads the tab shape).
const TAB_BAR_ROWS = [
  {
    name: 'color?',
    type: "TabsProps['color']",
    note: "Theme color for the active tab's indicator/tint.",
  },
  {
    name: 'radius?',
    type: "TabsProps['radius']",
    note: 'Corner radius of the tab buttons. Default 0.',
  },
];

const DEMO_CATEGORIES = ['All gear', 'Cameras', 'Audio', 'Lighting'] as const;

const DEMO_ITEMS: { name: string; category: string; status: string }[] = [
  { name: 'field_camera_a', category: 'Cameras', status: 'available' },
  { name: 'studio_camera', category: 'Cameras', status: 'on loan' },
  { name: 'podcast_mic_kit', category: 'Audio', status: 'available' },
  { name: 'field_recorder', category: 'Audio', status: 'available' },
  { name: 'light_panel_a', category: 'Lighting', status: 'repair due' },
  { name: 'ring_light', category: 'Lighting', status: 'available' },
];

/** A complete compound PageShell scaled into a fixed-height box
 * (heightMode="100%"): persisted-free sidebar with a working collapse
 * control, header with actions, a tab row, and the capped content scroll
 * frame. */
function PageShellDemo() {
  const [category, setCategory] = useState<string>('All gear');

  const items =
    category === 'All gear'
      ? DEMO_ITEMS
      : DEMO_ITEMS.filter(item => item.category === category);

  return (
    <Box
      h={420}
      style={{
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-md)',
        overflow: 'hidden',
      }}
    >
      <PageShell
        heightMode="100%"
        sidebarWidth={200}
        tabs={[
          { id: 'items', label: 'Items', active: true },
          {
            id: 'history',
            label: 'History',
            onClick: () =>
              notifications.info(
                'Tabs link router-agnostically -- this one just fires onClick.'
              ),
          },
        ]}
      >
        <PageShell.Sidebar>
          <Stack gap={2} p="sm" component="nav" aria-label="Demo categories">
            {DEMO_CATEGORIES.map(entry => (
              <NavLink
                key={entry}
                component="button"
                label={entry}
                active={category === entry}
                onClick={() => setCategory(entry)}
                style={{ borderRadius: 'var(--mantine-radius-md)' }}
              />
            ))}
          </Stack>
        </PageShell.Sidebar>
        <PageShell.Main>
          <PageShell.Header
            title="Inventory"
            actions={
              <Button
                size="sm"
                variant="light"
                onClick={() => notifications.success('Gear item saved')}
              >
                Add gear
              </Button>
            }
          />
          <PageShell.Content>
            <Stack gap="xs" py="sm">
              {items.map(item => (
                <Group key={item.name} justify="space-between" wrap="nowrap">
                  <Text size="sm" ff="monospace">
                    {item.name}
                  </Text>
                  <Badge
                    variant="light"
                    color={item.status === 'available' ? 'green' : 'orange'}
                  >
                    {item.status}
                  </Badge>
                </Group>
              ))}
            </Stack>
          </PageShell.Content>
        </PageShell.Main>
      </PageShell>
    </Box>
  );
}

export function PageShellPage() {
  return (
    <ComponentDoc
      title="PageShell"
      lead="The page-level layout primitive, as a compound component: a collapsible (optionally persisted) sidebar, a header row, an optional tab row, and scroll-managed content with a banner slot -- with a simple title/actions form that still works as a one-liner."
      bareDemo
      demoIntro='A full compound shell inside a fixed-height frame (heightMode="100%"): the sidebar collapses from the floating control on its edge, the category nav filters the content, the tab row rides above the body, and the header action fires a real notification.'
      demo={<PageShellDemo />}
      usage={USAGE}
      usageMinHeight={400}
      propsTables={[
        {
          title: 'Props',
          intro:
            'The root also spreads StackProps onto its outer frame. Layering: the shell sits on bg.level1, sidebar and header share bg.level2, content defaults to bg.level3.',
          rows: ROOT_ROWS,
        },
        { title: 'PageShell.Sidebar props', rows: SIDEBAR_ROWS },
        { title: 'PageShell.Header props', rows: HEADER_ROWS },
        { title: 'PageShell.Content props', rows: CONTENT_ROWS },
        {
          title: 'PageShellTab',
          intro:
            'The shape of each entry in the root tabs prop; PAGE_SHELL_TAB_BAR_HEIGHT is exported alongside it.',
          rows: TAB_ROWS,
        },
        {
          title: 'TabBar props (beyond tabs)',
          intro:
            'Only reachable composing TabBar directly (a shell-level child, alongside or instead of the root tabs shorthand) -- the root tabs prop only threads the tab shape, not these bar-level knobs.',
          rows: TAB_BAR_ROWS,
        },
      ]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          The sidebar collapses to a slide-away rail on desktop and an overlay
          drawer on mobile; drawerStateKey persists the desktop state. Inside a
          RailShell, topOffset defaults to that chrome&apos;s headerHeight, so
          the height math clears the fixed header exactly with no prop and
          nothing to keep in sync; pass topOffset explicitly only for chrome the
          kit did not render. Consumers composing their own
          sub-components can read the shell&apos;s shared state via
          usePageShellContext (exported from @ui/core).
        </Text>
        <Text size="sm">
          The tab row&apos;s presence in the height math (hasTabBar) is a
          registration, not a derived flag: the root seeds it from its own tabs
          prop so the built-in tab row keeps working with zero extra effort, but
          a consumer rendering their OWN tab row can register it the same way --
          call setHasTabBar(true) from usePageShellContext() in a layout effect
          on mount, with a matching setHasTabBar(false) cleanup on unmount,
          exactly like the built-in TabBar does.
        </Text>
        <Text size="sm" c="dimmed">
          The{' '}
          <Anchor
            component={Link}
            href={PAGE_SHELL_DEMO_PATH}
            size="sm"
            fw={500}
          >
            full-screen demo
          </Anchor>{' '}
          runs the compound shell at viewport scale inside a RailShell chrome,
          including the scrollClamp switch and the topNotch banner.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
