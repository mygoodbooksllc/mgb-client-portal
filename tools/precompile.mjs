// Build step for the portal (Vercel's build command, `npm run build`).
//
// Copies the site into dist/ (what Vercel serves) and compiles every file in
// index.html's window.__SOURCE_ORDER ahead of time into
// dist/precompiled/<path>.js with the same settings index.html's in-browser
// Babel uses: classic JSX runtime (React.createElement / React.Fragment),
// TypeScript types stripped, nothing else changed (no bundling, no
// minifying, same global scope). index.html runs those copies and only falls
// back to compiling in the browser for a file that has none.
//
// Run locally: npm install && npm run build, then serve dist/.
import { transform } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist");

// Never copied: build tooling and its output. .vercelignore is honored too
// (Vercel already applies it on upload; this keeps a local build the same).
const ALWAYS_SKIP = new Set([".git", "node_modules", "dist", "tools", "package.json", "package-lock.json"]);

function globToRegex(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp("^" + esc + "$");
}
function loadIgnore() {
  const file = path.join(ROOT, ".vercelignore");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => ({ dirOnly: l.endsWith("/"), re: globToRegex(l.replace(/^\//, "").replace(/\/$/, "")) }));
}
const IGNORE = loadIgnore();
function ignored(rel, isDir) {
  const parts = rel.split("/");
  if (parts.length === 1 && ALWAYS_SKIP.has(rel)) return true;
  const base = parts[parts.length - 1];
  return IGNORE.some((p) => (!p.dirOnly || isDir) && (p.re.test(rel) || p.re.test(base)));
}

function copyTree(fromDir, toDir, relBase = "") {
  fs.mkdirSync(toDir, { recursive: true });
  for (const ent of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
    if (ignored(rel, ent.isDirectory())) continue;
    const src = path.join(fromDir, ent.name);
    const dst = path.join(toDir, ent.name);
    if (ent.isDirectory()) copyTree(src, dst, rel);
    else if (ent.isFile()) fs.copyFileSync(src, dst);
  }
}

export function sourceOrder(html) {
  const m = html.match(/window\.__SOURCE_ORDER\s*=\s*\[([\s\S]*?)\];/);
  if (!m) throw new Error("window.__SOURCE_ORDER not found in index.html");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

export function loaderFor(file) {
  if (file.endsWith(".tsx")) return "tsx";
  if (file.endsWith(".ts")) return "ts";
  // .js files are compiled with the React preset in the browser too, so
  // they may contain JSX.
  return "jsx";
}

export async function compileOne(file, code) {
  const out = await transform(code, {
    loader: loaderFor(file),
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    // No down-leveling: the in-browser Babel path never lowered syntax either.
    target: "esnext",
    sourcefile: file,
    // Keep identifiers and layout readable, like the Babel output.
    minify: false,
    legalComments: "inline",
  });
  return out.code;
}

async function main() {
  const t0 = Date.now();
  fs.rmSync(OUT, { recursive: true, force: true });
  copyTree(ROOT, OUT);
  const order = sourceOrder(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"));
  let bytes = 0;
  for (const file of order) {
    const src = path.join(ROOT, file);
    if (!fs.existsSync(src)) throw new Error(`${file} is in __SOURCE_ORDER but does not exist`);
    let code;
    try {
      code = await compileOne(file, fs.readFileSync(src, "utf8"));
    } catch (e) {
      throw new Error(`could not compile ${file}: ${e.message}`);
    }
    const dst = path.join(OUT, "precompiled", file + ".js");
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, code);
    bytes += code.length;
  }
  console.log(`precompile: ${order.length} files, ${(bytes / 1e6).toFixed(1)} MB, ${Date.now() - t0} ms -> dist/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
