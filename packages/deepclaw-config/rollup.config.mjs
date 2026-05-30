import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";

export default [
  {
    input: "src/index.ts",

    output: [
      {
        file: "dist/index.js",
        format: "esm"
      }
    ],

    external: [
      /^node:/,
      '@deepclaw/core',
      '@deepclaw/i18n',
      '@deepclaw/utils',
      // CJS packages: bundling breaks default import interop; leave to Node at runtime.
      'dotenv',
    ],

    plugins: [
      nodeResolve(),
      typescript()
    ]
  }
];