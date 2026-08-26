import { FeaturesSection } from './FeaturesSection';
import { HeroSection } from './HeroSection';
import { QuickstartSection } from './QuickstartSection';

/** The marketing landing page ('/'): hero, feature grid (each card linking
 * to its docs page), and quickstart. Docs and demo are their own routes. */
export function LandingPage() {
  return (
    <>
      <HeroSection />
      <FeaturesSection />
      <QuickstartSection />
    </>
  );
}
