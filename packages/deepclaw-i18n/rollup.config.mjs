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
      // CJS packages: bundling breaks default import interop; leave to Node at runtime.
      'i18next',
      '@deepclaw/config',
    ],

    plugins: [
      nodeResolve(),
      typescript()
    ]
  }
];