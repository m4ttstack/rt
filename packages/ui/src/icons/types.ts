import type { ComponentType } from 'react';

import type { Icons } from './Icons';
import type { IconProps } from './lucideWrapperFn';
import type { AppIcons } from './registry';

export type { IconProps } from './lucideWrapperFn';

// Every registry entry (lucide-backed or brand) must satisfy this shape --
// a component that accepts the kit's fixed icon prop surface.
export type IconComponent = ComponentType<IconProps>;

// The full set of valid `<Icon name="..." />` values. Derived from the
// registry itself so adding/removing an entry in Icons.ts automatically
// updates the type -- no separate list to keep in sync.
export type IconName = keyof typeof Icons | (keyof AppIcons & string);
