/**
 * الغرض: اختبارُ فصلِ زمنِ العميلِ إلى ترويساتٍ وجسمٍ (LOAD-01 · أداةُ فصلِ الفجوةِ،
 * 2026-10-26) — تأخيرٌ معلومٌ يُحقنُ في الخادمِ المحليِّ (في الترويساتِ أو في الجسمِ)
 * ويُتحققُ من ظهورِهِ في الحدِّ الصحيحِ عندَ العميلِ، معَ مسارِ الفشلِ الشبكيِّ.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";

let server: http.Server;
let url = "";
/** دالةُ النداءِ منَ المكتبةِ — تُحلُّ بعدَ ضبطِ GATEWAY_URL في beforeAll. */
let callHttp: typeof import("../../deploy/capacity-run/load/lib.ts").http;
let gatewayUrlBefore: string | undefined;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/slow-headers") {
      // الترويساتُ تتأخرُ 60ms والجسمُ فوريٌّ — التأخيرُ يسكنُ ttfb لا bodyMs.
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json", "X-Request-Id": "req-sh" });
        res.end('{"ok":true}');
      }, 60);
      return;
    }
    if (req.url === "/slow-body") {
      // الترويساتُ فوريةٌ والجسمُ يتأخرُ 70ms — التأخيرُ يسكنُ bodyMs لا ttfb.
      // (flushHeaders يُخرجُ الترويساتَ فورًا وإلا جمّعها Node حتى أولِ كتابةٍ.)
      res.writeHead(200, { "content-type": "application/json", "X-Request-Id": "req-sb" });
      res.flushHeaders();
      setTimeout(() => res.end('{"ok":true}'), 70);
      return;
    }
    if (req.url === "/kill-connection") {
      // قطعٌ صامتٌ: لا ردَّ ولا ترويساتٍ — فشلٌ شبكيٌّ خالصٌ عندَ العميلِ.
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { "content-type": "application/json", "X-Request-Id": "req-fast" });
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      url = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
      resolve();
    });
  });
  gatewayUrlBefore = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = url;
  process.env.DISPATCH_TRACE_FILE = "";
  ({ http: callHttp } = await import("../../deploy/capacity-run/load/lib.ts"));
});

afterAll(() => {
  rmSync("/tmp/load-http-split-run", { recursive: true, force: true });
  // إعادةُ البيئةِ كما كانتْ: العنوانُ يُحلُّ وقتَ النداءِ فلا يُتركَ أثرٌ لاختبارٍ
  // على غيرِهِ (اختباراتٌ أخرى تعتمدُ العنوانَ الافتراضيَّ).
  if (gatewayUrlBefore === undefined) delete process.env.GATEWAY_URL;
  else process.env.GATEWAY_URL = gatewayUrlBefore;
  server.closeAllConnections?.();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("فصل زمن العميل: ترويسات ثم جسم", () => {
  test("تأخير الترويسات يسكن في ttfbMs وتأخير الجسم في bodyMs", async () => {
    const slowHeaders = await callHttp("/slow-headers");
    expect(slowHeaders.status).toBe(200);
    expect(slowHeaders.ttfbMs).not.toBeNull();
    expect(slowHeaders.ttfbMs as number).toBeGreaterThanOrEqual(35);
    expect(slowHeaders.ttfbMs as number).toBeLessThanOrEqual(140);
    expect(slowHeaders.bodyMs).not.toBeNull();
    expect(slowHeaders.bodyMs as number).toBeLessThan(35);

    const slowBody = await callHttp("/slow-body");
    expect(slowBody.status).toBe(200);
    expect(slowBody.ttfbMs).not.toBeNull();
    expect(slowBody.ttfbMs as number).toBeLessThan(35);
    expect(slowBody.bodyMs).not.toBeNull();
    expect(slowBody.bodyMs as number).toBeGreaterThanOrEqual(40);
    expect(slowBody.bodyMs as number).toBeLessThanOrEqual(150);

    // الكلُّ = الجزءانِ: لا زمنٌ يُبتلَعُ ولا يُزادُ.
    expect(slowBody.elapsedMs).toBeGreaterThanOrEqual(
      (slowBody.ttfbMs as number) + (slowBody.bodyMs as number) - 1,
    );
  });

  test("الفشل الشبكي: ttfbMs وbodyMs معدومان لا صفر، والزمن الكامل حقيقي", async () => {
    // الفشلُ الشبكيُّ منَ الخادمِ نفسِهِ: يُقطعُ المقبسَ قبلَ أيِّ ردٍّ (BASE يُحلُّ
    // وقتَ الاستيرادِ فلا يُبدَّلُ بعدَهُ — القطعُ على المسارِ يصنعُ الفشلَ نفسَهُ).
    const failed = await callHttp("/kill-connection", { timeoutMs: 500 });
    expect(failed.status).toBe(0);
    expect(failed.networkError).not.toBeNull();
    expect(failed.ttfbMs).toBeNull();
    expect(failed.bodyMs).toBeNull();
    expect(failed.elapsedMs).toBeGreaterThan(0);
  });

  test("عمود http_call يحمل الحدين مع معرف الطلب", async () => {
    const runDir = "/tmp/load-http-split-run";
    rmSync(runDir, { recursive: true, force: true });
    mkdirSync(`${runDir}/evidence`, { recursive: true });
    process.env.RUN_DIR = runDir;
    process.env.DISPATCH_TRACE_FILE = `${runDir}/evidence/trace.jsonl`;
    const { PathRecorder } = await import("../../deploy/capacity-run/load/lib.ts");
    const rec = new PathRecorder({ path: "miniapp_http", gen: "genT" });
    const result = await callHttp("/slow-body");
    rec.httpCallLog("rides_create", result);
    const lines = readFileSync(`${runDir}/evidence/load-events.jsonl`, "utf8")
      .split("\n")
      .filter((l) => l !== "");
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(row.requestId).toBe("req-sb");
    expect(row.ttfbMs).toBe(result.ttfbMs);
    expect(row.bodyMs).toBe(result.bodyMs);
    // العمودُ يُدوَّرُ إلى 0.01ms كما في http(): يُقارَن بالقيمةِ المدوّرةِ لا الخامّة.
    expect(row.elapsedMs).toBe(Math.round(result.elapsedMs * 100) / 100);
    expect(existsSync(`${runDir}/evidence/load-events.jsonl`)).toBe(true);
    process.env.DISPATCH_TRACE_FILE = "";
  });
});
