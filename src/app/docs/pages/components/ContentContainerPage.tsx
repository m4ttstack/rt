import { Box, ContentContainer, MAX_CONTENT_WIDTH, Text } from '@ui/core';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { ContentContainer, MAX_CONTENT_WIDTH } from '@ui/core';",
  '',
  '<ContentContainer>',
  '  {/* fluid up to MAX_CONTENT_WIDTH (1280px), centered, my/p="md" */}',
  '  {pageContent}',
  '</ContentContainer>;',
  '',
  '// Size your own elements relative to the content column:',
  'const bannerWidth = MAX_CONTENT_WIDTH * 1.25;',
].join('\n');

// Rows transcribed from src/ui/core/content-container/ContentContainer.tsx --
// the preset defaults Container.withProps applies. Any ContainerProps value
// overrides them per call site.
const PROPS_ROWS = [
  {
    name: 'fluid',
    type: 'boolean',
    note: 'Preset true: the container tracks its parent width instead of snapping to Mantine size steps.',
  },
  {
    name: 'maw',
    type: 'number',
    note: 'Preset MAX_CONTENT_WIDTH (1280): the readability cap on wide viewports.',
  },
  {
    name: 'mx / w',
    type: "'auto' / '100%'",
    note: 'Preset: centered, stretching to the cap.',
  },
  {
    name: 'p',
    type: 'MantineSpacing',
    note: "Preset 'md': the standard content padding.",
  },
  {
    name: '...rest',
    type: 'ContainerProps',
    note: 'ContentContainerProps IS ContainerProps -- the preset only sets defaults, so every Container prop applies.',
  },
];

export function ContentContainerPage() {
  return (
    <ComponentDoc
      title="ContentContainer"
      lead="The page-level content wrapper: a fluid Container capped at MAX_CONTENT_WIDTH (1280px, also exported from @ui/core), centered, with a vertical margin and standard padding. It paints no background of its own."
      demoIntro="The dashed outline is the container's edge: it fills the available width up to the cap and centers itself in anything wider."
      demo={
        <Box bg="var(--ui-bg-1)" py="sm">
          <ContentContainer
            style={{
              border: '1px dashed var(--mantine-color-default-border)',
              borderRadius: 'var(--mantine-radius-sm)',
            }}
          >
            <Text size="sm" c="dimmed" ta="center">
              ContentContainer: fluid, maw {MAX_CONTENT_WIDTH}px, centered
            </Text>
          </ContentContainer>
        </Box>
      }
      usage={USAGE}
      usageMinHeight={210}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          Built with Mantine&apos;s factory preset mechanism
          (Container.withProps), so it keeps Container&apos;s full typing
          including the polymorphic component prop. PageShell.Content wraps
          content in this same component by default (opt out with
          contentContainer={'{false}'} for full-bleed pages; already off under
          scrollClamp); Notch sizes itself against MAX_CONTENT_WIDTH to read as
          page-level chrome.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
