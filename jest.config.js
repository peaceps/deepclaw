/** @type {import("jest").Config} **/
export default {
  testEnvironment: "node",
  moduleNameMapper: {
    "^@core$": "<rootDir>/src/core/index.ts",
    "^@agent$": "<rootDir>/src/agent/index.ts",
    "^@ui$": "<rootDir>/src/ui/index.ts",
    "^@utils$": "<rootDir>/src/utils/index.ts",
    "^@e2e$": "<rootDir>/e2e/index.ts",
    "^@config$": "<rootDir>/.deepclaw.config.json",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.test.json",
      },
    ],
  },
};