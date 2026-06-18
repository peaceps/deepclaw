import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";

export default {
  input: "src/main.ts",

  output: {
    file: "dist/main.js",
    format: "esm",
  },

  external: [
    /^node:/,
    '@deepclaw/agent',
    '@deepclaw/im',
    '@deepclaw/node-utils',
		"@deepclaw/core",
		"@deepclaw/config",
    '@deepclaw/i18n',
  ],

  plugins: [
    nodeResolve({
      preferBuiltins: true
    }),
    typescript()
  ]
};
