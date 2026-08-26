import { useSchemeColors } from '@ui/hooks';

/**
 * The app's header surface, as `SiteShell`/`RailShell` `headerProps`: a
 * slightly translucent take on bg.level2 so the backdrop blur reads as
 * depth while staying scheme-aware (no raw gray-N values), layered over
 * the shell's default hairline.
 */
export function useSiteHeaderProps() {
  const { bg } = useSchemeColors();

  return {
    style: {
      backgroundColor: `color-mix(in srgb, ${bg.level2} 88%, transparent)`,
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
    },
  } as const;
}
