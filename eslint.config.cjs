const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // This project is mostly frontend scripts; keep output focused.
      "no-console": "off",
      "no-debugger": "warn",
      "no-unused-vars": "off",
      "no-prototype-builtins": "off",
    },
  },
  {
    files: ["test_*.mjs"],
    rules: {
      // These test files use `require(...)`, which isn't available in browsers.
      "no-undef": "off",
    },
  },
];
