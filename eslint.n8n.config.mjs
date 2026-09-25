// Separate flat-config entry point for the n8n community-node verification linter
// (`@n8n/eslint-plugin-community-nodes`).
//
// This is kept apart from `.eslintrc.js` (the legacy config used by `npm run lint`,
// which stays on ESLint's classic config format) because the community-nodes plugin
// only ships a flat config, and its rules are additional n8n-specific checks (icon
// files, credential conventions, webhook lifecycle completeness, package.json
// metadata, etc.) layered on top of the general TypeScript/eslint:recommended rules
// `npm run lint` already enforces.
//
// Run with `npm run lint:n8n`. Requires ESLint to run in flat-config mode
// (`ESLINT_USE_FLAT_CONFIG=true`, set by the npm script) since the installed ESLint
// major version here is 8.57, the last 8.x release, which supports flat config behind
// that flag; the rules themselves only use stable ESLint APIs.
import n8nCommunityNodes from '@n8n/eslint-plugin-community-nodes';
import tsParser from '@typescript-eslint/parser';
import jsoncParser from 'jsonc-eslint-parser';

export default [
  // Global ignores (an object with only `ignores` applies to the whole config, like
  // a legacy .eslintignore).
  {
    ignores: ['dist/**', 'node_modules/**', 'test/**', 'scripts/**'],
  },
  {
    ...n8nCommunityNodes.configs.recommended,
    // The plugin's recommended config sets no `files`, so without this it would only
    // ever be applied to the default `**/*.js` files ESLint matches; our node source
    // and credentials are TypeScript.
    files: ['nodes/**/*.ts', 'credentials/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      sourceType: 'module',
      ecmaVersion: 2019,
    },
  },
  {
    ...n8nCommunityNodes.configs.recommended,
    // package.json-focused rules (package-name-convention, valid-author,
    // require-files-array, n8n-object-validation, valid-peer-dependencies, …) look at
    // `context.filename` themselves and no-op on any file that isn't package.json, so
    // this second entry only actually engages those.
    files: ['package.json'],
    languageOptions: {
      parser: jsoncParser,
    },
  },
];
