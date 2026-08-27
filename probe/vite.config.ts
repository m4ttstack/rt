import { defineConfig } from 'vite';

import { mattstackVite } from '@mattstack/app-kit/vite';

export default defineConfig(mattstackVite({ apiPort: 11031 }));
