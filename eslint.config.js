import globals from "globals";
import pluginJs from "@eslint/js";

export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
    },
    rules: {
      // Recorded deviation from the plan's verbatim config (S31): underscore-
      // prefixed args are intentionally-unused parameters, not sloppiness.
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
    },
  },
  {
    // Tests and tooling run under bun with Node built-ins in scope; the
    // browser-only globals above cannot lint them (S23).
    files: ["tests/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        Bun: "readonly",
      },
    },
  },
  pluginJs.configs.recommended,
];
