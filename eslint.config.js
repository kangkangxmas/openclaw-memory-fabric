// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "**/dist/**",
      "**/dist-test/**",
      "**/*.js",          // only lint TypeScript source
      "scripts/**",       // shell scripts / plain mjs — not TS
      "examples/**",
      "packages/web/**"   // separate tsconfig — linted by its own config
    ]
  },

  // Base ESLint recommended
  eslint.configs.recommended,

  // TypeScript-ESLint recommended (type-aware)
  ...tseslint.configs.recommendedTypeChecked,

  // Project-level parser settings — include both src and test tsconfigs
  {
    languageOptions: {
      parserOptions: {
        project: [
          "packages/plugin/tsconfig.json",
          "packages/plugin/tsconfig.test.json",
          "packages/sidecar/tsconfig.json",
          "packages/sidecar/tsconfig.test.json"
        ],
        tsconfigRootDir: import.meta.dirname
      }
    }
  },

  // Rule overrides
  {
    rules: {
      // Allow explicit any only where unavoidable (CJS interop)
      "@typescript-eslint/no-explicit-any": "warn",
      // Suppress require-imports rule — we use createRequire intentionally for ajv
      "@typescript-eslint/no-require-imports": "off",
      // Consistent type imports
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      // Void operator for floating promises is preferred over eslint-disable
      "@typescript-eslint/no-floating-promises": "error",
      // Allow underscore-prefixed unused vars
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Fastify route handlers must be async even without explicit await
      "@typescript-eslint/require-await": "off",
      // No console.* in production code — use Logger
      "no-console": ["warn", { allow: ["error"] }]
    }
  },

  // Test files: node:test describe/it return Promise — disable floating-promises and console warnings
  {
    files: ["packages/*/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "no-console": "off"
    }
  },

  // Disable all formatting rules (Prettier handles that)
  prettier
);
