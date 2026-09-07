#!/usr/bin/env python3
"""
Bundle the MyGoodBooks prototype into ONE self-contained HTML file.

Why this exists
---------------
The prototype normally runs from index.html, which pulls React, Babel and jsPDF
from CDNs and fetches app.jsx / data.js at runtime. That works locally but not
as a shareable link: a published Artifact runs under a strict CSP that blocks
every external host except Google Fonts, and it can't fetch sibling files.

So this script inlines everything — vendor libraries, the JSX sources, the CSS
and the logo — into a single file with no external requests.

Usage
-----
    python3 build.py                 # writes dist/mygoodbooks-dashboard.html
    python3 build.py --out other.html
    python3 build.py --refresh       # re-download vendor libs, ignoring cache

Requires only Python 3 (no Node, no npm, no pip installs) — deliberately, since
this project has no build toolchain yet.

Notes
-----
* Sources and vendor libs are base64-encoded rather than pasted inline. A raw
  `</script>` sequence anywhere inside a minified library or a JS string would
  otherwise terminate the surrounding script tag and corrupt the bundle.
* JSX is still transformed at runtime by Babel standalone, exactly as index.html
  does. That keeps this script dependency-free at the cost of ~2.9MB of Babel and
  about a second of startup. If a real Vite build lands (Phase 4), delete this.
* The output deliberately omits <!doctype>, <html>, <head> and <body>: the
  Artifact publisher supplies that wrapper. Browsers imply those tags too, so the
  file still opens correctly on its own from disk.
"""

import argparse
import base64
import mimetypes
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
CACHE = ROOT / ".build-cache"

# Pinned so a shared link can't break when a CDN ships a new major version.
# NOTE: jspdf-autotable's real filename is jspdf.plugin.autotable.min.js, and it
# must come from jsDelivr — unpkg serves it without CORS headers.
VENDOR = {
    "react": "https://unpkg.com/react@18/umd/react.production.min.js",
    "reactDom": "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
    "babel": "https://unpkg.com/@babel/standalone@7.24.7/babel.min.js",
    "jspdf": "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
    "autotable": "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js",
}

# Matches the title already published at the shared link. Artifact titles should
# stay stable across redeploys — viewers find the tab by its name and icon.
TITLE = "MyGoodBooks"
FONTS = (
    # Bitter / IBM Plex Sans / IBM Plex Mono, shared by the shell and <DailyClose />.
    # Google Fonts is the one external host a published Artifact's CSP allows.
    "https://fonts.googleapis.com/css2?family=Bitter:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,500;1,600&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
)


def fetch_vendor(name: str, url: str, refresh: bool) -> str:
    """Download a vendor library, caching it so repeat builds are offline-friendly."""
    CACHE.mkdir(exist_ok=True)
    cached = CACHE / f"{name}.js"
    if cached.exists() and not refresh:
        return cached.read_text(encoding="utf-8")
    print(f"  downloading {name} …", flush=True)
    with urllib.request.urlopen(url, timeout=60) as response:
        text = response.read().decode("utf-8")
    cached.write_text(text, encoding="utf-8")
    return text


def b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def data_uri(path: pathlib.Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def read(name: str) -> str:
    path = ROOT / name
    if not path.exists():
        sys.exit(f"error: missing required source file {name}")
    return path.read_text(encoding="utf-8")


def build(out_path: pathlib.Path, refresh: bool) -> None:
    print("Reading sources …")
    app_src = read("app.jsx")
    data_src = read("data.js")
    css = read("styles.css")

    # The Daily Close ships as its own component directory. Its CSS is already
    # `dc-` prefixed and scoped to .dc-dailyClose, so it can simply be appended.
    daily_close_css = read("components/daily-close/DailyClose.css")
    daily_close_sample = read("components/daily-close/sampleData.ts")
    daily_close_component = read("components/daily-close/DailyClose.tsx")
    daily_close_adapter = read("components/daily-close/fromClient.js")
    css = css + "\n\n/* ---- components/daily-close/DailyClose.css ---- */\n" + daily_close_css

    # The bundle can't fetch sibling files, so fold the logo in as a data URI.
    logo = ROOT / "logo.webp"
    if logo.exists():
        app_src = app_src.replace('src="logo.webp"', f'src="{data_uri(logo)}"')
    else:
        print("  warning: logo.webp not found — the brand mark will be blank")

    print("Collecting vendor libraries …")
    libs = {name: fetch_vendor(name, url, refresh) for name, url in VENDOR.items()}

    payload = {
        **{name: b64(code) for name, code in libs.items()},
        "data": b64(data_src),
        "app": b64(app_src),
        "dcSample": b64(daily_close_sample),
        "dcComponent": b64(daily_close_component),
        "dcAdapter": b64(daily_close_adapter),
    }
    blobs = ",\n".join(f'  {name}: "{value}"' for name, value in payload.items())

    html = f"""<title>{TITLE}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="{FONTS}" rel="stylesheet" />
<script>
// Mirrors the same block in index.html. Dark is the product default; light is
// opt-in. This has to run before the stylesheet below is applied, otherwise a
// light-OS machine renders the light palette until React mounts and sets the
// attribute itself — which in this bundle means until Babel has compiled the
// whole app, so the flash is very visible.
(function () {{
  var stored = null;
  try {{
    stored = localStorage.getItem("mygoodbooks_theme_v1");
  }} catch (e) {{}}
  document.documentElement.setAttribute(
    "data-theme",
    stored === "light" ? "light" : "dark"
  );
}})();
</script>
<style>
{css}
</style>

<div id="root"></div>

<script>
// Generated by build.py — do not edit this file directly. Edit app.jsx /
// data.js / styles.css and re-run the script.
var BUNDLE = {{
{blobs}
}};

function decodeSource(encoded) {{
  var binary = atob(encoded);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}}

// Appending a script with .text runs it synchronously, so ordering is preserved
// without any loader or network request.
function run(code) {{
  var script = document.createElement("script");
  script.text = code;
  document.body.appendChild(script);
}}

try {{
  run(decodeSource(BUNDLE.react));
  run(decodeSource(BUNDLE.reactDom));
  run(decodeSource(BUNDLE.babel));
  run(decodeSource(BUNDLE.jspdf));
  run(decodeSource(BUNDLE.autotable));

  // Force Babel's "classic" JSX runtime; "automatic" expects a real bundler.
  var jsx = ["react", {{ runtime: "classic" }}];

  function compile(source, filename, presets) {{
    return Babel.transform(decodeSource(source), {{ filename: filename, presets: presets }}).code;
  }}

  run(compile(BUNDLE.data, "data.js", [jsx]));
  // The Daily Close is TypeScript. A plain .ts file must NOT get the JSX plugin
  // — Babel rejects that pair — and both must be defined before app.jsx renders.
  run(compile(BUNDLE.dcSample, "sampleData.ts", ["typescript"]));
  run(compile(BUNDLE.dcComponent, "DailyClose.tsx", ["typescript", jsx]));
  run(compile(BUNDLE.dcAdapter, "fromClient.js", [jsx]));
  run(compile(BUNDLE.app, "app.jsx", [jsx]));
}} catch (err) {{
  document.getElementById("root").innerHTML =
    '<pre style="padding:24px;font:14px ui-monospace,monospace;color:#a4442c;white-space:pre-wrap">' +
    "Failed to start the dashboard:\\n\\n" + (err && err.stack ? err.stack : err) + "</pre>";
  throw err;
}}
</script>
"""

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"\nWrote {out_path.relative_to(ROOT)} ({size_mb:.2f} MB)")
    if size_mb > 16:
        print("warning: over the 16MB Artifact limit — the publish will be rejected")


def main() -> None:
    parser = argparse.ArgumentParser(description="Bundle the prototype into one HTML file.")
    parser.add_argument("--out", default="dist/mygoodbooks-dashboard.html", help="output path")
    parser.add_argument("--refresh", action="store_true", help="re-download vendor libraries")
    args = parser.parse_args()
    build((ROOT / args.out).resolve(), args.refresh)


if __name__ == "__main__":
    main()
