import { Icons } from './Icons';
import type { IconName, IconProps } from './types';

export type IconComponentProps = IconProps & { name: IconName };

// Dynamic icon lookup by registry name -- an alternative to using
// `Icons.trash` directly when the icon to render is only known at runtime
// (e.g. driven by a prop or a data-driven config).
export const Icon = ({ name, ...props }: IconComponentProps) => {
  const IconComponent = Icons[name];
  return <IconComponent {...props} />;
};
