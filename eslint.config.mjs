import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';

export default [
  {
    files: ['src/**/*.js', 'src/**/*.jsx'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        console: 'readonly',
        crypto: 'readonly',
        TextEncoder: 'readonly',
        Buffer: 'readonly'
      ,
        // Common browser/window globals used in frontend code
        atob: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        document: 'readonly',
        window: 'readonly',
        setTimeout: 'readonly',
        FormData: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        TextDecoder: 'readonly',
        // Node global used in some resolver files
        process: 'readonly'
      }
    },
    plugins: {
      'react': react,
      'react-hooks': reactHooks
    },
    settings: {
      react: {
        version: '18.2'
      }
    },
    rules: {
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Reduce some severities to warnings to avoid CI failing for legacy code
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'warn',
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
      'require-await': 'error',

      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-duplicate-imports': 'error',

      'no-var': 'error',
      'prefer-const': 'warn',
      'eqeqeq': ['warn', 'always'],

      'no-console': ['warn', { allow: ['log', 'error', 'warn'] }],

      'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
      'complexity': ['warn', 35],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 4]
    }
  }
];
