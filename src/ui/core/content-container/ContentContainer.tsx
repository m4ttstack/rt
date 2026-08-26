import { Container } from '@mantine/core';
import type { ContainerProps } from '@mantine/core';

/**
 * `ContentContainer` is a preset `Container` (via the factory's static
 * `.withProps`), so its prop surface IS `ContainerProps` -- aliased here so
 * consumers can type wrappers/presets without reaching for the Mantine name.
 */
export type ContentContainerProps = ContainerProps;

/**
 * Content max-width in px -- keeps long-form page content readable on wide
 * viewports. Exported through the `@ui/core` barrel so app code can size
 * its own elements relative to the content column, the same way kit
 * components like `Notch` do.
 */
export const MAX_CONTENT_WIDTH = 1280;

/**
 * The page-level content wrapper: a `fluid` `Container` capped at
 * `MAX_CONTENT_WIDTH`, centered, with standard padding and a vertical
 * margin so stacked content areas breathe. It paints no background of its
 * own -- content sits directly on whatever surface hosts the container
 * (e.g. `PageShell.Content`'s canvas). Callers can override any of these
 * via props since Mantine's static `.withProps` (the factory-generated
 * preset mechanism, see AGENTS.md section 4) only sets defaults.
 */
export const ContentContainer = /* @__PURE__ */ Container.withProps({
  fluid: true,
  maw: MAX_CONTENT_WIDTH,
  mx: 'auto',
  my: 'md',
  w: '100%',
  p: 'md',
});
