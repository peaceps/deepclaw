import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default {
  input: "src/main.tsx",

  output: {
    file: "dist/cli.js",
    format: "esm",

    banner: "#!/usr/bin/env node"
  },

  external: [
    /^node:/,
    '@deepclaw/agent',
    '@deepclaw/utils',
    '@deepclaw/i18n',
    'ink',
    'meow',
    'react',
    'react-i18next',
    'react/jsx-runtime',
    'string-width',
  ],

  plugins: [
    nodeResolve({
      preferBuiltins: true
    }),

    commonjs(),

    typescript()
  ]
};