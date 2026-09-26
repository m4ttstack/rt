import { Suspense } from 'react';
import { Box, Center, Loader, LoadingOverlay, Skeleton } from '@mantine/core';
import type {
  LoaderProps,
  LoadingOverlayProps,
  MantineStyleProps,
  SkeletonProps,
} from '@mantine/core';

interface LazyLoaderBase {
  /** The lazily-loaded content (typically a `React.lazy` component). */
  children: React.ReactNode;
}

/**
 * Default: a centered Mantine `Loader` in a min-height box, so the fallback
 * doesn't collapse to nothing. `loaderType` may be omitted.
 */
export interface CenteredLazyLoaderProps extends LazyLoaderBase {
  loaderType?: 'centered';
  /** Passed through to the fallback `Loader`. */
  loaderProps?: LoaderProps;
  /** Fallback container's minimum height. @default 120 */
  minHeight?: number | string;
}

/** A full `LoadingOverlay` over the boundary's area. */
export interface OverlayLazyLoaderProps extends LazyLoaderBase {
  loaderType: 'overlay';
  loaderProps?: LoadingOverlayProps['loaderProps'];
}

/** A `LoadingOverlay` inside a styled `Box` you size via `containerProps`. */
export interface ContainedLazyLoaderProps extends LazyLoaderBase {
  loaderType: 'contained';
  containerProps: MantineStyleProps;
  loaderProps?: LoadingOverlayProps['loaderProps'];
}

/** A `Skeleton` placeholder shaped by `skeletonProps`. */
export interface SkeletonLazyLoaderProps extends LazyLoaderBase {
  loaderType: 'skeleton';
  skeletonProps: SkeletonProps;
}

/** An arbitrary fallback node. */
export interface CustomLazyLoaderProps extends LazyLoaderBase {
  loaderType: 'custom';
  loader: React.ReactNode;
}

export type LazyLoaderProps =
  | CenteredLazyLoaderProps
  | OverlayLazyLoaderProps
  | ContainedLazyLoaderProps
  | SkeletonLazyLoaderProps
  | CustomLazyLoaderProps;

// The overlay/contained variants use a bars loader by default -- quieter
// than a spinner under a dimming overlay.
const defaultOverlayLoaderProps: LoadingOverlayProps['loaderProps'] = {
  type: 'bars',
  color: 'gray',
  opacity: 0.5,
};

/**
 * A `Suspense` boundary with a themed fallback, in one of several shapes
 * (`loaderType`): the default `'centered'` spinner, an `'overlay'` /
 * `'contained'` `LoadingOverlay`, a `'skeleton'` placeholder, or a
 * `'custom'` node. The standard "route/panel is code-split, show a
 * placeholder until its chunk (and any data it suspends on) resolves"
 * wrapper.
 */
export function LazyLoader(props: LazyLoaderProps) {
  return <Suspense fallback={renderFallback(props)}>{props.children}</Suspense>;
}

function renderFallback(props: LazyLoaderProps): React.ReactNode {
  switch (props.loaderType) {
    case 'overlay':
      return (
        <LoadingOverlay
          visible
          loaderProps={{ ...defaultOverlayLoaderProps, ...props.loaderProps }}
        />
      );
    case 'contained':
      return (
        <Box {...props.containerProps}>
          <LoadingOverlay
            visible
            loaderProps={{ ...defaultOverlayLoaderProps, ...props.loaderProps }}
          />
        </Box>
      );
    case 'skeleton':
      return <Skeleton {...props.skeletonProps} />;
    case 'custom':
      return props.loader;
    case 'centered':
    case undefined:
      return (
        <Center mih={props.minHeight ?? 120} data-testid="lazy-loader-fallback">
          <Loader {...props.loaderProps} />
        </Center>
      );
  }
}
