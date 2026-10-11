import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // No setState synchronously in an effect body (#401, #410). Load data
      // with a tRPC query hook or set state in the fetch's callback; read
      // browser-only values with useSyncExternalStore (see useIsClient).
      "react-hooks/set-state-in-effect": "error",
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
