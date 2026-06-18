import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import copy from "rollup-plugin-copy";

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
      '@deepclaw/node-utils',
      // CJS packages: bundling breaks default import interop; leave to Node at runtime.
    ],

    plugins: [
      nodeResolve(),
      typescript(),
      copy({
        targets: [
          { src: "resources", dest: "dist" }
        ]
      })
    ]
  }
];