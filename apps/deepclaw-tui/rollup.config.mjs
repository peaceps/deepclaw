import path from "node:path";
import { fileURLToPath } from "node:url";
import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

const packages = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "packages");

/**
 * Only one package of this workspace is ever published, so the others cannot be reached by
 * name at runtime and are bundled in here instead. What they compiled to is what gets read,
 * which is why `tsc -b` has to have run before this.
 */
const workspacePackages = {
  name: "workspace-packages",

  // ahead of the typescript plugin, which would otherwise answer with the sources
  resolveId: {
    order: "pre",
    handler(source) {
      const name = /^@deepclaw\/([a-z0-9-]+)$/.exec(source)?.[1];
      return name ? path.join(packages, `deepclaw-${name}`, "dist", "index.js") : null;
    }
  }
};

const entry = "src/main.tsx";

export default {
  input: entry,

  output: {
    file: "dist/main.js",
    format: "esm",

    banner: "#!/usr/bin/env node"
  },

  // whatever is left named after bundling is a dependency the published package declares
  external: (id, _importer, isResolved) =>
    id !== entry && !isResolved && !id.startsWith(".")
    && !id.startsWith("@deepclaw/") && !path.isAbsolute(id),

  plugins: [
    workspacePackages,
    nodeResolve({
      preferBuiltins: true
    }),
    commonjs(),
    typescript()
  ]
};
