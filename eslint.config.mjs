import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/.next/',
      '**/dist/',
      'docs/',
      '**/next-env.d.ts',
      '**/playwright-report/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Only packages/db may talk to Postgres or build queries; everything else goes through its
    // repositories, which apply tenantScope (PRD §21 / §29).
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['packages/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'postgres', message: 'Use @agentos/db instead.' }],
          patterns: [
            { group: ['drizzle-orm', 'drizzle-orm/*'], message: 'Use @agentos/db repositories.' },
          ],
        },
      ],
    },
  },
  {
    // Test helpers (truncate tables, test database) must never reach application code.
    files: ['**/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', 'packages/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'postgres', message: 'Use @agentos/db instead.' }],
          patterns: [
            { group: ['drizzle-orm', 'drizzle-orm/*'], message: 'Use @agentos/db repositories.' },
            { group: ['@agentos/db/testing'], message: 'Test-only helpers.' },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
    },
    settings: { next: { rootDir: 'apps/web' } },
  },
);
