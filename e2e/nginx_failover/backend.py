import os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
NAME = os.environ.get("NAME", "?")
class H(BaseHTTPRequestHandler):
    def _ok(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n: self.rfile.read(n)
        body = NAME.encode()
        self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    do_GET = do_POST = _ok
    def log_message(self, *a): pass
ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("PORT", "8000"))), H).serve_forever()
