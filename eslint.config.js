import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Screens are thin and token-only (AGENTS.md). Two rules enforce it in apps/web and apps/mobile:
 * - no literal user-facing strings in JSX (text children or label attributes): every string is a
 *   catalog key read through t();
 * - no arbitrary Tailwind values (text-[13px], shadow-[...], grid-cols-[...]): utilities come from
 *   the token theme in apps/web/src/styles.css.
 */
const noLiteralStrings = [
  {
    selector: 'JSXText[value=/[A-Za-z\\u0A80-\\u0AFF]/]',
    message: 'No literal text in JSX: add a key to en.json and gu.json and read it with t().',
  },
  {
    selector:
      'JSXAttribute[name.name=/^(aria-label|aria-description|placeholder|title|alt|label)$/] > Literal',
    message: 'No literal label in JSX: add a key to en.json and gu.json and read it with t().',
  },
];
const noArbitraryTailwind = [
  {
    selector: 'Literal[value=/(^|[\\s:])[a-z0-9-]+-\\[[^\\]]+\\]/]',
    message: 'No arbitrary Tailwind values: use a token utility (text-body, p-4, shadow-low).',
  },
  {
    selector: 'TemplateElement[value.raw=/(^|[\\s:])[a-z0-9-]+-\\[[^\\]]+\\]/]',
    message: 'No arbitrary Tailwind values: use a token utility (text-body, p-4, shadow-low).',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/.expo/**',
      'apps/mobile/ios/**',
      'apps/mobile/android/**',
      'apps/mobile/expo-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['apps/web/src/**/*.tsx', 'apps/mobile/src/**/*.tsx'],
    ignores: ['**/*.test.tsx', 'apps/web/src/test/**'],
    rules: {
      'no-restricted-syntax': ['error', ...noLiteralStrings, ...noArbitraryTailwind],
    },
  },
  prettier,
);
