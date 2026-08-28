import { mattstackEslint } from '@mattstack/app-kit/eslint';
import tseslint from 'typescript-eslint';

export default tseslint.config(...mattstackEslint());
