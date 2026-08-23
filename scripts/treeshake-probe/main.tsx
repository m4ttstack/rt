import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Button, MantineProvider } from '@ui/core';
import { theme } from '@ui/design-system';

import '@ui/styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme}>
      <Button>hello</Button>
    </MantineProvider>
  </StrictMode>
);
