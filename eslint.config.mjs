import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'web/dist/**', '.wrangler/**'],
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'web/**/*.ts', 'web/**/*.tsx'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-debugger': 'error',
      'no-eval': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['web/src/**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
