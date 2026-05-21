import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";

export default {
  input: "src/index.ts",

  output: {
    file: "dist/index.js",
    format: "esm",
  },

  external: [
    /^node:/,
    '@deepclaw/core',
    '@deepclaw/utils',
    'dingtalk-stream'
  ],

  plugins: [
    nodeResolve({
      preferBuiltins: true
    }),
    typescript()
  ]
};