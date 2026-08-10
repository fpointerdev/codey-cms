import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "playwright-report/**", "test-results/**", ".release/**", "prisma/generated/**"]
  },
  {
    files: ["apps/web/web/**/*.js"],
    ...eslint.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser
    },
    rules: {
      ...eslint.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  },
  {
    files: ["scripts/**/*.mjs"],
    ...eslint.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node
    },
    rules: {
      ...eslint.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  },
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", {
        disallowTypeAnnotations: false,
        fixStyle: "inline-type-imports",
        prefer: "type-imports"
      }],
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": ["error", {
        checksVoidReturn: {
          arguments: false,
          attributes: true,
          inheritedMethods: true,
          properties: true,
          returns: true,
          variables: true
        }
      }],
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": "error"
    }
  },
  {
    files: ["test/**/*.ts", "src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": ["error", {
        allowForKnownSafeCalls: ["test"],
        ignoreVoid: true
      }]
    }
  },
  {
    files: ["src/**/*.service.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "express",
          message: "Domain services must not depend on Express request or response types."
        }]
      }]
    }
  }
];
