import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Button, MantineProvider } from '@mattstack/app-kit/core';
import { theme } from '@mattstack/app-kit/design-system';

import '@mattstack/app-kit/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme}>
      <Button>hello</Button>
    </MantineProvider>
  </StrictMode>
);
