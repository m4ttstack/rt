import { Box, Flex, Group, ScrollArea, Transition } from '@mantine/core';
import type {
  ContainerProps,
  FlexProps,
  ScrollAreaAutosizeProps,
} from '@mantine/core';

import { useElementSize, useSchemeColors } from '@mattstack/app-kit/hooks';
import { ContentContainer } from '../../content-container/ContentContainer';
import {
  useIsInMain,
  useIsInPageShell,
  usePageShellContentHeight,
  usePageShellContext,
} from '../hooks';
import { SidebarToggleButton } from './SidebarToggleButton';

const Wrapper = ({
  children,
  contentContainer,
  contentContainerProps,
}: {
  children: React.ReactNode;
  contentContainer: boolean;
  contentContainerProps?: ContainerProps;
}) => {
  if (contentContainer) {
    // flex 1 stretches the container down the content column so it fills
    // the shell frame even when the page is short; callers can still
    // override via contentContainerProps.
    return (
      <ContentContainer flex={1} {...contentContainerProps}>
        {children}
      </ContentContainer>
    );
  }
  return <>{children}</>;
};

export interface PageShellContentProps {
  /** Content, or a render prop receiving the computed available height. */
  children: React.ReactNode | ((height: string) => React.ReactNode);
  /** Surface override. @default bg.level3 */
  bg?: FlexProps['bg'];
  /**
   * Extra props for the outer ScrollArea (scroll mode only).
   *
   * In its default mode the content area IS the page's scroll frame -- a
   * `ScrollArea.Autosize` capped at the available height. Wrapping children
   * in another `ScrollArea`, or clamping them with `mah="__vh"`, gives you
   * two scrollbars fighting each other. Tune the built-in one through here,
   * or take the frame over entirely with the root's `scrollClamp`.
   */
  scrollAreaProps?: ScrollAreaAutosizeProps;
  /**
   * Wraps children in the kit's `ContentContainer` (capped, centered
   * column). A page's content column is the shell's job, so the common case
   * needs no prop: this is ON by default in the normal scroll mode, and OFF
   * under the root's `scrollClamp`, where the consumer owns the frame and a
   * margined, capped column would fight their own inner scroll. Set it
   * explicitly either way to override -- `false` for full-bleed content (a
   * map, a split pane, an edge-to-edge table), `true` to keep the column
   * inside a clamped layout.
   * @default true, or false under `scrollClamp`
   */
  contentContainer?: boolean;
  contentContainerProps?: ContainerProps;
  /**
   * Banner slot docked at the top of the content area -- pair it with
   * `Notch` as the content, which squares its own top corners against this
   * edge. The slot stays mounted while `opened` is false: the wrapper
   * animates its height between the measured banner height and 0 so the
   * banner slides away instead of popping out of layout.
   */
  topNotch?: { content: React.ReactNode; opened: boolean };
}

/**
 * The shell's content area, in one of two scroll modes chosen by the root's
 * `scrollClamp`:
 *
 * - `false` (default): a `ScrollArea.Autosize` capped at the available
 *   height -- the page scrolls naturally inside it.
 * - `true`: a fixed-height, overflow-hidden column for layouts that manage
 *   their own inner scrolling (tables, split panes); pair with the render
 *   prop to size inner frames against the computed height.
 *
 * Also hosts the `topNotch` banner slot and, when the sidebar is collapsed
 * into a drawer and no header is around to hold the opener, floats a
 * sidebar toggle over its top-left corner.
 */
export const Content = ({
  children,
  bg,
  scrollAreaProps,
  topNotch,
  contentContainer,
  contentContainerProps,
}: PageShellContentProps) => {
  useIsInMain('Content');
  useIsInPageShell('Content');

  const { bg: schemeBg } = useSchemeColors();
  const {
    scrollClamp,
    hasHeader,
    toggleSidebar,
    hasSidebar,
    collapsedSidebar,
  } = usePageShellContext();

  const height = usePageShellContentHeight();

  // Clamp mode hands the frame to the caller (fixed height, overflow hidden,
  // their own inner scroll), and a block-level container with vertical
  // margins inside that frame clips rather than scrolls -- so the column is
  // on by default only in scroll mode. An explicit prop still wins.
  const withContentContainer = contentContainer ?? !scrollClamp;

  // The banner's rendered height, so the collapse wrapper below can animate
  // between an exact pixel height and 0 (`height: auto` can't transition).
  const { ref: notchRef, height: notchHeight } = useElementSize();

  const topNotchUI = topNotch && (
    <Box
      style={{
        height: topNotch.opened ? notchHeight : 0,
        transition: 'height 200ms linear',
      }}
    >
      <Transition
        keepMounted
        mounted={topNotch.opened}
        transition="slide-down"
        duration={200}
        timingFunction="ease"
      >
        {transitionStyle => (
          <div ref={notchRef} style={transitionStyle}>
            <Group w="100%" justify="center">
              {topNotch.content}
            </Group>
          </div>
        )}
      </Transition>
    </Box>
  );

  // The opener normally lives in the header; with no header it floats here
  // so a drawer-collapsed sidebar always stays reachable.
  const sidebarToggle = collapsedSidebar && !hasHeader && hasSidebar && (
    <SidebarToggleButton
      pos="absolute"
      top={0}
      left={0}
      m="xs"
      onClick={toggleSidebar}
      withShadow
      size="2.5rem"
      iconSize={26}
    />
  );

  const renderedChildren =
    typeof children === 'function' ? children(height) : children;

  if (scrollClamp) {
    return (
      <Flex
        id="page-shell-content"
        bg={bg ?? schemeBg.level3}
        direction="column"
        flex={1}
        mih={height}
        h={height}
        mah={height}
        style={{ overflow: 'hidden' }}
      >
        {topNotchUI}
        <Wrapper
          contentContainer={withContentContainer}
          contentContainerProps={contentContainerProps}
        >
          {sidebarToggle}
          {renderedChildren}
        </Wrapper>
      </Flex>
    );
  }

  return (
    <ScrollArea.Autosize
      id="page-shell-content"
      mah={height}
      bg={bg ?? schemeBg.level3}
      flex={1}
      {...scrollAreaProps}
    >
      {topNotchUI}
      <Flex direction="column" flex={1} mih={height}>
        <Wrapper
          contentContainer={withContentContainer}
          contentContainerProps={contentContainerProps}
        >
          {sidebarToggle}
          {renderedChildren}
        </Wrapper>
      </Flex>
    </ScrollArea.Autosize>
  );
};
