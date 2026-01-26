import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isWatching = process.env.ROLLUP_WATCH === "true";

export default {
  input: "src/plugin.ts",
  output: {
    file: "io.deckops.containers.sdPlugin/bin/plugin.js",
    format: "cjs",
    sourcemap: isWatching,
  },
  plugins: [
    json(),
    nodeResolve({
      preferBuiltins: true,
    }),
    commonjs(),
    typescript({
      tsconfig: "./tsconfig.json",
      sourceMap: isWatching,
    }),
  ],
  external: [],
};
