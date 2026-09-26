import tseslint from 'typescript-eslint';

import { mattstackEslint } from '@mattstack/app-kit/eslint';

export default tseslint.config(...mattstackEslint());
