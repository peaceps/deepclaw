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
      '@deepclaw/i18n',
      '@deepclaw/utils',
      '@deepclaw/core',
      '@deepclaw/config',
      'gray-matter',
      /^@anthropic-ai\/sdk(\/.*)?$/,
      /^openai(\/.*)?$/,
    ],

    plugins: [
      nodeResolve(),
      typescript()
    ]
  }
];