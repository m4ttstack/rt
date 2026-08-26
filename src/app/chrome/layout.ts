import { useSchemeColors } from '@ui/hooks';

/** Height of the sticky site header, in px. Shared so sticky elements below
 * it (the docs sidebar) and in-page scroll offsets can clear it exactly. */
export const HEADER_HEIGHT = 56;

/**
 * The site-wide header surface, as `SiteShell` `headerProps`: a slightly
 * translucent take on bg.level2 so the backdrop blur reads as depth while
 * staying scheme-aware (no raw gray-N values), layered over SiteShell's
 * default hairline. Shared by every `SiteShell` instance the app renders
 * (the main site shell and the demo's sidebar shell), so the site keeps one
 * header identity.
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
