import path from "node:path";
import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";

const entry = "src/main.ts";

export default {
  input: entry,

  output: {
    file: "dist/deepclaw.js",
    format: "esm",
  },

  // whatever is left named after bundling is a dependency the published package declares
  external: (id, _importer, isResolved) =>
    id !== entry && !isResolved && !id.startsWith(".") && !path.isAbsolute(id),

  plugins: [
    nodeResolve({
      preferBuiltins: true
    }),
    typescript()
  ]
};
