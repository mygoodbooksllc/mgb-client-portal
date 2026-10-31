const http = require("http");
const fs = require("fs");
const path = require("path");

const DIR = "/Users/holdengray/Desktop/Mygoodbooks-app-code/client-dashboard";
const PORT = 8420;

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".ts": "text/plain",
  ".tsx": "text/plain",
  ".css": "text/css",
  ".webp": "image/webp",
};

// Mirror of vercel.json's (now enforcing) Content-Security-Policy value,
// served only when MGB_CSP_TEST=1 (see below).
const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' " +
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js " +
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js " +
  "https://unpkg.com/@babel/standalone@7.24.7/babel.min.js " +
  "https://unpkg.com/@supabase/supabase-js@2.45.4/dist/umd/supabase.js " +
  "https://cdn.jsdelivr.net/npm/jspdf@3.0.4/dist/jspdf.umd.min.js " +
  "https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.8/dist/jspdf.plugin.autotable.min.js https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' data: https://fonts.gstatic.com; " +
  "img-src 'self' data: blob: https://xumsqmhccgfjnlmieqyu.supabase.co; " +
  "connect-src 'self' https://xumsqmhccgfjnlmieqyu.supabase.co wss://xumsqmhccgfjnlmieqyu.supabase.co; " +
  "frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; " +
  "frame-ancestors 'none'";

http
  .createServer((req, res) => {
    let filePath;
    try {
      filePath = path.resolve(DIR, "." + decodeURIComponent(req.url.split("?")[0]));
    } catch (e) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }
    // No `..` (or `..%2f`) escapes out of DIR.
    if (filePath !== DIR && !filePath.startsWith(DIR + path.sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if (filePath === DIR || req.url.split("?")[0].endsWith("/")) filePath = path.join(filePath, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath);
      const headers = { "Content-Type": TYPES[ext] || "application/octet-stream" };
      // Off by default. With MGB_CSP_TEST=1 this serves vercel.json's policy
      // as an enforcing Content-Security-Policy, the same as production, so a
      // locally-loaded app that still needs
      // something the policy drops (script-src 'unsafe-eval' was the open
      // question — Babel/standalone compiles to a string we inject as an
      // inline <script>, which is 'unsafe-inline', not eval) fails loudly
      // here instead of silently in a report endpoint nobody reads.
      // Keep the value below byte-identical to vercel.json's.
      if (process.env.MGB_CSP_TEST === "1") {
        headers["Content-Security-Policy"] = CSP;
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`Serving ${DIR} on port ${PORT}`);
  });
