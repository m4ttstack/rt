import '@testing-library/jest-dom/vitest';

import { installJsdomPolyfills } from '@mattstack/app-kit/test-utils';

installJsdomPolyfills();
if (typeof window !== 'undefined') window.scrollTo = () => {};
