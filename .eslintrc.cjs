/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2024: true,
  },
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  ignorePatterns: ["node_modules/", "dist/", "coverage/"],
  extends: ["eslint:recommended", "prettier"],
  rules: {
    "no-console": "off",
    "no-debugger": "warn",
  },
  overrides: [
    {
      files: ["test_*.mjs"],
      rules: {
        "no-undef": "off",
      },
    },
  ],
};
