// @ts-check
import tseslint from "typescript-eslint";

/** Regex that matches any import containing an "infrastructure/" segment */
const INFRA_REGEX = /\binfrastructure\//;

export default tseslint.config(
  // Base TypeScript configuration for all src files
  {
    files: ["src/**/*.ts"],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Domain layer: must never import from infrastructure
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "infrastructure/",
              message: "Domain layer must not depend on infrastructure. Use domain types only.",
            },
          ],
        },
      ],
    },
  },

  // Application layer: infrastructure imports below are flagged as warnings
  // documenting known technical debt (ports not yet extracted for git/fs/pi adapters).
  // codec/* is allowed as an anti-corruption layer for markdown parsing.
  {
    files: ["src/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              regex: "infrastructure/git/",
              message: "Application layer should use the VersionControl port, not the git adapter directly.",
            },
            {
              regex: "infrastructure/fs/",
              message: "Application layer should use the RunStateRepository/ArtifactRepository ports, not fs adapters directly.",
            },
            {
              regex: "infrastructure/pi/(human-gate|stage-return-tool|session-dispatcher|progress-reporter)",
              message: "Application layer should use ports (GateManager, PipelineServices), not pi adapters directly.",
            },
            {
              regex: "infrastructure/telemetry/",
              message: "Application layer should use the TelemetrySink port, not the telemetry adapter directly.",
            },
          ],
        },
      ],
    },
  },

  // Global ignores
  {
    ignores: ["node_modules/**", ".pipeline/**", "**/*.d.ts", "eslint.config.js"],
  },
);
