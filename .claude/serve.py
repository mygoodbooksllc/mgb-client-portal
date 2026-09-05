import functools
import http.server

DIRECTORY = "/Users/holdengray/Desktop/Mygoodbooks-app-code/client-dashboard"
PORT = 8420

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIRECTORY)
with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"Serving {DIRECTORY} on port {PORT}")
    httpd.serve_forever()
