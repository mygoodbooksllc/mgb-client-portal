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

http
  .createServer((req, res) => {
    let filePath = path.join(DIR, decodeURIComponent(req.url.split("?")[0]));
    if (filePath.endsWith("/")) filePath = path.join(filePath, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`Serving ${DIR} on port ${PORT}`);
  });
