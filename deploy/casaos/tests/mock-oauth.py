#!/usr/bin/env python3
"""خادمُ OAuth وهميٌّ محلّيٌّ لاختبارِ مسارِ rclone دونَ Google (ADR 0298).

الاستعمال: mock-oauth.py PORT MODE LOG
  MODE: ok       ⇒ /token يعطي رمزاً جديداً (code أو refresh_token)
        invalid  ⇒ /token يردُّ 400 invalid_grant (رمزٌ منتهٍ أو مسحوب)
  /auth يعيدُ التوجيهَ فوراً إلى redirect_uri بـcode (بديلُ موافقةِ المستخدمِ في المتصفّح).
  LOG: أسماءُ الطلباتِ ونوعُ المنحة فقط، بلا قيم.
"""
import json, sys, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT, MODE, LOG = int(sys.argv[1]), sys.argv[2], sys.argv[3]
N = {"n": 0}


def log(s):
    with open(LOG, "a") as f:
        f.write(s + "\n")


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/auth":
            log("auth")
            loc = q["redirect_uri"][0] + "?" + urllib.parse.urlencode({"code": "MOCKCODE", "state": q["state"][0]})
            self.send_response(302); self.send_header("Location", loc); self.end_headers()
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        body = urllib.parse.parse_qs(self.rfile.read(int(self.headers.get("Content-Length", 0))).decode())
        grant = body.get("grant_type", ["?"])[0]
        log("token grant=" + grant)
        if MODE == "invalid":
            out, code = {"error": "invalid_grant", "error_description": "Token has been expired or revoked."}, 400
        else:
            N["n"] += 1
            out, code = {"access_token": "MOCK-ACCESS-%d" % N["n"], "token_type": "Bearer",
                         "refresh_token": "MOCK-REFRESH-TOKEN-SECRET-MARKER", "expires_in": 3599}, 200
        b = json.dumps(out).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)


HTTPServer(("127.0.0.1", PORT), H).serve_forever()
