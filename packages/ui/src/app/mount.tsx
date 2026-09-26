import { StrictMode, type ReactNode } from 'react';
import {
  MantineProvider,
  mergeThemeOverrides,
  type MantineThemeOverride,
} from '@mantine/core';
import { createRoot, type Root } from 'react-dom/client';

import { markMounted, registerSimpleAlerts } from '@mattstack/app-kit/boot';
import { theme as tokyoTheme } from '@mattstack/app-kit/design-system';
import { ModalsProvider } from '@mattstack/app-kit/modals';
import { Notifications } from '@mattstack/app-kit/notifications';

import '@mattstack/app-kit/styles.css';

export interface MountOptions {
  /** Merged on top of the Tokyo theme. Colour NAMES cannot be added here; see app-colors.ts. */
  theme?: MantineThemeOverride;
  /** Caps a tall toast so its body scrolls instead of growing. @default 400 */
  notificationMaxHeight?: number;
  /** @default document.getElementById('root') */
  container?: HTMLElement;
}

/**
 * The mattstack boot sequence: alerts registered BEFORE render so a throw
 * inside the first render still lands in the fatal panel, `markMounted`
 * after so the mounted app owns its own errors from then on.
 */
export function mountMattstackApp(
  node: ReactNode,
  opts: MountOptions = {}
): Root {
  const container = opts.container ?? document.getElementById('root');
  if (!container)
    throw new Error('mountMattstackApp: no #root element to mount into.');
  const theme = opts.theme
    ? mergeThemeOverrides(tokyoTheme, opts.theme)
    : tokyoTheme;
  registerSimpleAlerts();
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <ModalsProvider>
          {node}
          <Notifications
            notificationMaxHeight={opts.notificationMaxHeight ?? 400}
          />
        </ModalsProvider>
      </MantineProvider>
    </StrictMode>
  );
  markMounted();
  return root;
}
