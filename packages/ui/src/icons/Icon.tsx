import { resolveIcon } from './registry';
import type { IconName, IconProps } from './types';

export type IconComponentProps = IconProps & { name: IconName };

export const Icon = ({ name, ...props }: IconComponentProps) => {
  const IconComponent = resolveIcon(name);
  return <IconComponent {...props} />;
};
