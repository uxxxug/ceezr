/**
 * الغرض: اختبارُ رصدِ حدودِ الردّ في جسرِ HTTP (LOAD-01 · أداةُ فصلِ الفجوةِ، 2026-10-26).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 *
 * لكلِّ مرحلةٍ يُحقنُ تأخيرٌ معلومٌ قابلٌ للتحكمِ (في `app.fetch` أو في أولِ جزءٍ من
 * الجسمِ) ويُتحققُ من ظهورِهِ في المرحلةِ الصحيحةِ لا المجاورةِ — إثباتٌ صناعيٌّ محليٌّ
 * لدلالةِ الطوابعِ، لا دليلًا على أثرِ A/B ولا السعةِ. وتُفحصُ مساراتُ النقصِ: بلا
 * جسمٍ، بلا معرّفِ طلبٍ، إغلاقٌ مبكرٌ، وبلا `onGap` أصلًا.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import http from "node:http";
import {
  createHttpBridge,
  type HttpGapTiming,
} from "../../apps/gateway/src/realtime/http-bridge.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** خادمٌ محليٌّ بالجسرِ — يُعادُ استعمالُهُ عبرَ الحالاتِ بإغلاقٍ وإعادةِ فتحٍ. */
function startServer(app: Parameters<typeof createHttpBridge>[0]): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer(createHttpBridge(app, 0));
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

const gaps: HttpGapTiming[] = [];
let server: { url: string; close: () => Promise<void> };

beforeAll(async () => {
  server = await startServer({
    onGap: (gap) => gaps.push(gap),
    fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path === "/slow-fetch") {
        await sleep(60);
        return new Response('{"ok":true}', {
          headers: { "content-type": "application/json", "X-Request-Id": "req-slow-fetch" },
        });
      }
      if (path === "/slow-body") {
        // جسمٌ يبدأُ بعدَ 70ms: التأخيرُ يجبُ أن يسكنَ ما بعدَ writeHead لا في fetchMs.
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            setTimeout(() => {
              controller.enqueue(new TextEncoder().encode('{"ok":true}'));
              controller.close();
            }, 70);
          },
        });
        return new Response(stream, {
          headers: { "content-type": "application/json", "X-Request-Id": "req-slow-body" },
        });
      }
      if (path === "/hanging-body") {
        // جسمٌ لا يصلُ أبدًا: للإغلاقِ المبكرِ منَ العميلِ.
        const stream = new ReadableStream<Uint8Array>({
          start() {
            /* لا يُرسَلُ شيءٌ */
          },
        });
        return new Response(stream, {
          headers: { "content-type": "application/json", "X-Request-Id": "req-hang" },
        });
      }
      if (path === "/no-body") {
        return new Response(null, { status: 204, headers: { "X-Request-Id": "req-no-body" } });
      }
      if (path === "/no-request-id") {
        return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
      }
      return new Response('{"ok":true}', {
        headers: { "content-type": "application/json", "X-Request-Id": "req-plain" },
      });
    },
  });
});

afterAll(async () => {
  await server.close();
});

async function gapOf(requestId: string): Promise<HttpGapTiming> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const found = gaps.find((g) => g.requestId === requestId);
    if (found !== undefined) return found;
    await sleep(20);
  }
  throw new Error(`لم يصل مردود الرصد للطلب ${requestId}`);
}

describe("رصد حدود الرد في جسر HTTP", () => {
  test("تأخير معلوم في app.fetch يسكن في fetchMs لا في كتابة الجسم", async () => {
    const res = await fetch(`${server.url}/slow-fetch`);
    expect(res.status).toBe(200);
    const gap = await gapOf("req-slow-fetch");
    // التأخيرُ المحقونُ 60ms: يظهرُ في fetchMs بهامشِ الجهازِ المحليِّ (±35)،
    // ولا يظهرُ في المسافةِ من writeHead إلى أولِ كتابةٍ (الجسمُ فوريٌّ).
    expect(gap.fetchMs).not.toBeNull();
    expect(gap.fetchMs as number).toBeGreaterThanOrEqual(35);
    expect(gap.fetchMs as number).toBeLessThanOrEqual(120);
    expect(gap.firstWriteMs).not.toBeNull();
    expect(gap.writeHeadMs).not.toBeNull();
    expect((gap.firstWriteMs as number) - (gap.writeHeadMs as number)).toBeLessThan(35);
    // والحدودُ الأخيرةُ مكتملةٌ بترتيبِها.
    expect(gap.closed).toBe(false);
    expect(gap.finishMs).not.toBeNull();
    expect(gap.finishMs as number).toBeGreaterThanOrEqual(gap.endMs as number);
  });

  test("تأخير معلوم في أول جزء من الجسم يسكن بعد writeHead لا في fetchMs", async () => {
    const res = await fetch(`${server.url}/slow-body`);
    expect(res.status).toBe(200);
    const gap = await gapOf("req-slow-body");
    expect(gap.fetchMs).not.toBeNull();
    // الجسمُ بدأ بعدَ 70ms منَ التسليمِ: المسافةُ writeHead→firstWrite تحملُهُ.
    expect(gap.firstWriteMs).not.toBeNull();
    const bodyDelay = (gap.firstWriteMs as number) - (gap.writeHeadMs as number);
    expect(bodyDelay).toBeGreaterThanOrEqual(45);
    expect(bodyDelay).toBeLessThanOrEqual(140);
    // وfetchMs لا يحملُهُ: بناءُ الردِّ فوريٌّ.
    expect(gap.fetchMs as number).toBeLessThan(35);
  });

  test("رد بلا جسم: firstWriteMs معدوم لا صفر، والباقي مكتمل", async () => {
    const res = await fetch(`${server.url}/no-body`);
    expect(res.status).toBe(204);
    const gap = await gapOf("req-no-body");
    expect(gap.firstWriteMs).toBeNull();
    expect(gap.endMs).not.toBeNull();
    expect(gap.finishMs).not.toBeNull();
    expect(gap.closed).toBe(false);
  });

  test("رد بلا X-Request-Id: requestId معدوم ولا يُخترع بديل", async () => {
    const res = await fetch(`${server.url}/no-request-id`);
    expect(res.status).toBe(200);
    // يُنتظرُ وصولُ مردودِ الرصدِ لهذا المسارِ تحديدًا (لا معرّفَ يُنتظرُ).
    const deadline = Date.now() + 2000;
    let found: HttpGapTiming | undefined;
    while (Date.now() < deadline && found === undefined) {
      found = gaps.find((g) => g.pathname === "/no-request-id" && g.closed === false);
      if (found === undefined) await sleep(20);
    }
    expect(found).toBeDefined();
    expect(found?.requestId).toBeNull();
  });

  test("إغلاق مبكر من العميل: closed صادق وfinishMs معدوم", async () => {
    const controller = new AbortController();
    const fetchPromise = fetch(`${server.url}/hanging-body`, { signal: controller.signal });
    // ننتظرُ وصولَ الترويساتِ ثمّ نقطعُ قبلَ أيِّ جسمٍ — فيُغلقُ الاتصالُ بلا finish.
    const timer = setTimeout(() => controller.abort(), 150);
    try {
      await fetchPromise;
    } catch {
      /* الإحباطُ المتوقعُ */
    }
    clearTimeout(timer);
    const gap = await gapOf("req-hang");
    expect(gap.closed).toBe(true);
    expect(gap.finishMs).toBeNull();
    // وما لُقطَ حتى اللحظةِ صادقٌ: الترويساتُ سُلّمت (writeHead) والجسمُ لم يبدأْ.
    expect(gap.writeHeadMs).not.toBeNull();
    expect(gap.firstWriteMs).toBeNull();
  });

  test("بلا onGap: لا رصد ولا خلل في السلوك", async () => {
    const plain = await startServer({
      fetch: async () => new Response('{"ok":true}'),
    });
    try {
      const res = await fetch(`${plain.url}/x`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('{"ok":true}');
      // لم يُضفْ شيءٌ إلى الرصدِ (العدادُ لم ينمُ).
      const before = gaps.length;
      await fetch(`${plain.url}/y`);
      expect(gaps.length).toBe(before);
    } finally {
      await plain.close();
    }
  });

  test("مردود واحد لكل طلب: لا ازدواج عند تلازم finish وclose", async () => {
    const before = gaps.length;
    const res = await fetch(`${server.url}/req-plain`);
    expect(res.status).toBe(200);
    const gap = await gapOf("req-plain");
    const count = gaps.filter((g) => g === gap || g.requestId === "req-plain").length;
    expect(count).toBe(1);
    expect(gaps.length).toBe(before + 1);
  });
});
