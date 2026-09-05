import { build } from "esbuild";
import { execSync } from "node:child_process";
import { readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");

// One entry point per component file (everything in src/ except the shared
// utils/styles/index files, which are bundled into each component instead
// of published as their own top-level artifacts).
const SKIP = new Set(["utils.ts", "index.ts", "styles.css"]);

const entryPoints = readdirSync(srcDir)
  .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !SKIP.has(f))
  .map((f) => path.join(srcDir, f));

mkdirSync(distDir, { recursive: true });

await build({
  entryPoints,
  outdir: distDir,
  format: "esm",
  bundle: true,
  splitting: false,
  target: "es2020",
  jsx: "automatic",
  external: ["react", "react-dom"],
  sourcemap: true,
  logLevel: "info",
});

// Also bundle the barrel (index.ts) as a single combined entry, for
// consumers that want everything in one import.
await build({
  entryPoints: [path.join(srcDir, "index.ts")],
  outfile: path.join(distDir, "index.js"),
  format: "esm",
  bundle: true,
  target: "es2020",
  jsx: "automatic",
  external: ["react", "react-dom"],
  sourcemap: true,
  logLevel: "info",
});

// Emit .d.ts declaration files alongside the JS bundles.
execSync("npx tsc -p tsconfig.json", { cwd: rootDir, stdio: "inherit" });

// Copy the design tokens/styles alongside the JS output so consumers can
// import "mygoodbooks-ds/dist/styles.css" directly.
copyFileSync(path.join(srcDir, "styles.css"), path.join(distDir, "styles.css"));

console.log("Build complete:", distDir);
