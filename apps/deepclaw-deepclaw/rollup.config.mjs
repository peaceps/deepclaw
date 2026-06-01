import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";

export default {
  input: "src/main.ts",

  output: {
    file: "dist/deepclaw.js",
    format: "esm",
  },

  external: [
    /^node:/,
    '@deepclaw/headless',
    '@deepclaw/tui',
    'meow',
  ],

  plugins: [
    nodeResolve({
      preferBuiltins: true
    }),
    typescript()
  ]
};
