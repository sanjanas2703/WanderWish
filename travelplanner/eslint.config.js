import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "backups/", "coverage/"] },
  js.configs.recommended,
  {
    files: ["server.js", "server/**/*.js", "scripts/**/*.js", "test/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: globals.node },
    rules: { "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }], "no-empty": ["error", { allowEmptyCatch: true }] }
  },
  {
    // Browser scripts share globals across <script> tags (no bundler), so undefined-name checks are off here.
    files: ["public/**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "script", globals: { ...globals.browser, Vue: "readonly", L: "readonly" } },
    rules: { "no-undef": "off", "no-unused-vars": "off", "no-empty": ["error", { allowEmptyCatch: true }] }
  },
  { files: ["public/services/globals.js", "public/data.js", "public/geo.js", "shared/**/*.js"], languageOptions: { sourceType: "module" } }
];
