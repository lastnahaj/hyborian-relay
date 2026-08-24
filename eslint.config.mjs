import eslint from "@eslint/js";
import typescriptEslint from "typescript-eslint";

export default typescriptEslint.config(
  {
    ignores: [
      ".vitepress/cache/**",
      ".vitepress/dist/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
    ],
  },
  eslint.configs.recommended,
  ...typescriptEslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: true }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    ...typescriptEslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { project: false },
      globals: { console: "readonly", process: "readonly" },
    },
    rules: {
      ...typescriptEslint.configs.disableTypeChecked.rules,
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
);
