import { Icons } from './Icons';
import type { IconComponent } from './types';

/**
 * Augment from an app to extend `IconName` with the keys it registers:
 *
 *   declare module '@mattstack/app-kit/icons' {
 *     interface AppIcons { hash: true }
 *   }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AppIcons {}

const appIcons = new Map<string, IconComponent>();

/** Call once at boot, before the first render; a key the kit or an earlier
    call already owns throws rather than silently shadowing. */
export function registerIcons(icons: Record<string, IconComponent>): void {
  for (const [name, component] of Object.entries(icons)) {
    if (name in Icons || appIcons.has(name)) {
      throw new Error(`registerIcons: "${name}" is already registered.`);
    }
    appIcons.set(name, component);
  }
}

export function resolveIcon(name: string): IconComponent {
  const kit = (Icons as Record<string, IconComponent | undefined>)[name];
  const found = kit ?? appIcons.get(name);
  if (!found) throw new Error(`Unknown icon "${name}".`);
  return found;
}

export function __resetAppIconsForTests(): void {
  appIcons.clear();
}
