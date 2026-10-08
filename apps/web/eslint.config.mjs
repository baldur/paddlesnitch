import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React Compiler's rule against setState in an effect flags the
      // fetch-on-mount pattern nine pages use. It works, and rewriting those
      // pages is its own piece of work, so it warns instead of failing the PR
      // checks. Don't add new ones.
      "react-hooks/set-state-in-effect": "warn",
      // A leading underscore marks a parameter or variable as unused on purpose.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The OpenNext deploy bundle (pnpm build:open-next): generated code.
    ".open-next/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
