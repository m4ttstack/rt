import '@testing-library/jest-dom/vitest';

import {
  installJsdomPolyfills,
  installTestTimeBudget,
} from '@mattstack/app-kit/test-utils';

installJsdomPolyfills();
installTestTimeBudget();
