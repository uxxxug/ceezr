/**
 * الغرض: جسرٌ بين خادمِ HTTP من Node وخادمِ Hono الذي يُرجِعُ Response من Web API.
 * الحالة: منفّذ فعلياً — المرحلة F4-04.
 * ينتمي إلى: apps/gateway/src/realtime
 *
 * ## لماذا هذا الجسرُ موجودٌ
 *
 * `Bun.serve` يُرجِعُ Responseً من Web API مباشرةً لكلِّ طلبٍ. و`Socket.IO`
 * يحتاجُ خادمَ HTTP من Node (`http.Server`) ليعلِّقَ عليه ترقيةَ WebSocket.
 * فلا سبيلَ إلى الجمعِ بينهما على المنفذِ نفسِه إلا بجسرٍ يُحوِّلُ طلبَ HTTP
 * الواردَ إلى `Request` من Web API، ويمرِّرُه إلى `app.fetch`، ثم يكتبُ الردَّ
 * على `ServerResponse`.
 *
 * وهو جسرٌ نحيفٌ لا يُضيفُ منطقاً تجاريّاً: لا تصريفَ ولا عدَّادَ ولا شيئاً.
 * كلُّ ذلك يبقى في `index.ts` حيثُ هوَ.
 *
 * ## رصدُ حدودِ الردّ (LOAD-01 · أداةُ فصلِ الفجوةِ، 2026-10-26)
 *
 * إن قُدّمَ `onGap` فَيُرصدُ لكلِّ طلبٍ **مردودٌ واحدٌ من ساعةٍ واحدةٍ** (الخادمِ) مقرونٌ
 * بمعرّفِ الطلبِ — لا يُطرحُ طابعٌ من طابعٍ عبرَ الساعاتِ. ودلالةُ كلِّ حدٍّ مسمّاةٌ
 * بدقّةٍ لا يُدّعى أكثرُ منها:
 *
 * - **دخولُ المعالجِ** = استدعاءُ هذا الجسرِ **بعدَ تحليلِ ترويساتِ الطلبِ** في محوّلِ
 *   Node — **ليسَ استقبالَ أولِ بايتٍ على المقبسِ** ولا لحظةَ بدءَ التوصيلِ.
 * - **حلُّ `app.fetch`** = اكتمالُ بناءِ كائنِ الردّ (يشملُ `serverMs` المُبلَّغَ في
 *   `httpreq` وفوقَهُ هامشَ التحويلِ والبواباتِ) — **ليسَ إرسالَ الردّ**.
 * - **`writeHead`/أولُ كتابةٍ/`end`** = لحظاتُ تسليمِ ترويساتِ الردّ وأولِ جزءٍ من جسمِهِ
 *   وإقفالِ التسليمِ إلى محوّلِ Node.
 * - **`finish`** = حدثُ `finish` على `ServerResponse` — كُتبتِ آخرُ البياناتِ إلى
 *   نظامِ التشغيلِ — **ليسَ إثباتَ استلامِ العميلِ**.
 * - إن أُغلِقَ الاتصالُ قبلَ `finish` فَيُعلَمُ `closed` وتبقى `finishMs` معدومةً —
 *   لا يُخترعُ طابعٌ بديلٌ ولا يُمنحُ اسمُ حدٍّ لم يُرصد.
 *
 * كلُّ المددِ **إزاحاتٌ من دخولِ المعالجِ** (ساعةٌ واحدةٌ)، والرصدُ لا يغيّرُ سلوكًا ولا
 * يُنشأُ أصلاً إلا بوجودِ `onGap`.
 *
 * ## ما قبلَ دخولِ الجسرِ (LOAD-01-GAP-PROBE-RUN2، 2026-10-27)
 *
 * - **أبكرُ نقطةٍ متاحةٍ لكلِّ طلبٍ** في `node:http` على Bun هي حدثُ `request` (فُحصَ محلّيًّا:
 *   حدثُ `data` على المقبسِ لا يُطلَقُ، و`connection` مرّةٌ لكلِّ اتصالٍ لا لكلِّ طلب).
 *   `stampRequestEvents` يُسجِّلُ مستمعًا **في رأسِ القائمةِ بعدَ ربطِ Socket.IO** فيختمُ
 *   الطلبَ لحظةَ الحدثِ، و`requestLeadMs` = دخولُ الجسرِ − تلكَ اللحظة (الساعةُ نفسُها).
 *   ما بينَ وصولِ البايتاتِ إلى المقبسِ وحدثِ `request` (التحليلُ وجدولةُ الحلقةِ) **لا يُقاس**.
 * - `inflightAtEntry` عددُ الطلباتِ داخلَ الجسرِ لحظةَ الدخولِ (شاملًا هذا)، و`connSeq` ترتيبُ
 *   الطلبِ على مقبسِهِ (1 = أولُ طلبٍ على اتصالٍ جديد)، و`loopOverdueAtEntryMs` مؤشّرُ مِجسِّ
 *   الحلقةِ لحظةَ الدخولِ إن مُرِّرَ — مؤشّرٌ لا مُكوِّنٌ.
 * - كلُّ ذلكَ خلفَ `onGap` نفسِه: بلا رصدٍ لا مستمعَ ولا عدّادَ ولا خريطة.
 */

import type { Server as HttpServer, IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { REQUEST_ID_HEADER } from "../observability/request-id.ts";

export interface HonoLike {
  fetch: (request: Request, server?: unknown) => Response | Promise<Response>;
  /** رصدُ حدودِ الردّ — اختياريّ؛ بغيابِهِ لا يُرصدُ شيءٌ ولا تُلتقطُ طوابعٌ. */
  onGap?: (gap: HttpGapTiming) => void;
  /** مؤشّرُ مِجسِّ الحلقةِ لحظةَ الدخولِ — اختياريّ، ولا يُقرأُ إلا معَ `onGap`. */
  loopOverdueMs?: () => number;
}

/** ختمُ حدثِ `request` على الطلبِ (ساعةُ العمليّةِ الرتيبة) — رمزٌ لا يتسرّبُ خارجَ الجسر. */
const REQUEST_EVENT_AT = Symbol("ceezr.requestEventAt");

/**
 * يُسجِّلُ مستمعَ `request` في رأسِ قائمةِ الخادمِ فيختمُ كلَّ طلبٍ لحظةَ الحدثِ — يُنادى
 * **بعدَ** ربطِ Socket.IO (الذي يلفُّ المستمعينَ القائمين) كي يكونَ الأبكرَ فعلًا. لا يكتبُ
 * ردًّا ولا يمسُّ الطلبَ إلا بالرمزِ. يُعيدُ دالّةَ فكٍّ للاختبار.
 */
export function stampRequestEvents(server: HttpServer): () => void {
  const listener = (req: IncomingMessage): void => {
    (req as unknown as Record<symbol, number>)[REQUEST_EVENT_AT] = performance.now();
  };
  server.prependListener("request", listener);
  return () => {
    server.off("request", listener);
  };
}

/**
 * مردودُ رصدِ حدودِ الطلبِ الواحدِ — كلُّ المددِ إزاحاتٌ بالميلي ثانيةِ من دخولِ معالجِ
 * الجسرِ بساعةِ الخادمِ نفسِها. القيمُ المعدومةُ (null) تعني «لم يُرصدْ/لا ينطبق» لا صفرًا.
 */
export interface HttpGapTiming {
  /** معرّفُ الطلبِ من رأسِ الردّ القائمِ (X-Request-Id) لا معرّفٌ جديد. */
  readonly requestId: string | null;
  readonly method: string;
  readonly pathname: string;
  /** دخولُ المعالجِ ← حلُّ `app.fetch` (اكتمالُ بناءِ الردّ). */
  readonly fetchMs: number | null;
  /** ← استدعاءُ `res.writeHead`. */
  readonly writeHeadMs: number | null;
  /** ← أولُ `res.write` لجزءٍ من الجسمِ (null إن لم يكنْ جسمٌ). */
  readonly firstWriteMs: number | null;
  /** ← استدعاءُ `res.end`. */
  readonly endMs: number | null;
  /** ← حدثُ `finish` (null إن أُغلِقَ الاتصالُ قبلَهُ). */
  readonly finishMs: number | null;
  /** أُغلِقَ الاتصالُ قبلَ اكتمالِ الردّ. */
  readonly closed: boolean;
  /** حدثُ `request` ← دخولُ الجسر (null إن لم يُختمِ الحدث: `stampRequestEvents` غيرُ مسجَّل). */
  readonly requestLeadMs: number | null;
  /** طلباتٌ داخلَ الجسرِ لحظةَ الدخولِ (شاملًا هذا الطلب). */
  readonly inflightAtEntry: number;
  /** ترتيبُ الطلبِ على مقبسِهِ (1 = أولُ طلبٍ على اتصالٍ جديد)؛ null بلا مقبس. */
  readonly connSeq: number | null;
  /** مؤشّرُ تأخُّرِ نبضةِ الحلقةِ لحظةَ الدخولِ (null بلا مِجسّ). */
  readonly loopOverdueAtEntryMs: number | null;
}

/**
 * يحوِّلُ `IncomingMessage` إلى `Request` من Web API.
 */
function toWebRequest(req: IncomingMessage, port: number): Request {
  const url = `http://localhost:${port}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  return new Request(url, {
    method: req.method ?? "GET",
    headers,
    // `req` itself is a ReadableStream in Node — Bun يدعمه مباشرةً
    body:
      req.method !== "GET" && req.method !== "HEAD"
        ? (req as unknown as ReadableStream)
        : undefined,
  });
}

/**
 * يكتبُ `Response` من Web API على `ServerResponse` من Node.
 */
/**
 * `stamp` اختياريّة: إن وُجدتْ تُلتقطُ فيها طوابعُ التسليمِ (writeHead/أولِ كتابةٍ/end)
 * كإزاحاتٍ من دخولِ المعالجِ (الساعةُ نفسُها)، ولا يتغيّرِ سلوكُ الكتابةِ قيدًا.
 */
async function writeWebResponse(
  response: Response,
  res: ServerResponse,
  stamp: ((field: "writeHeadMs" | "firstWriteMs" | "endMs", at: number) => void) | null,
): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    const existing = headers[key];
    if (existing !== undefined) {
      headers[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      headers[key] = value;
    }
  });
  res.writeHead(response.status, headers);
  stamp?.("writeHeadMs", performance.now());
  const body = response.body;
  if (body) {
    const reader = body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
      stamp?.("firstWriteMs", performance.now());
    }
  }
  res.end();
  stamp?.("endMs", performance.now());
}

/**
 * يُنشئُ معالِجَ طلباتٍ يجمعُ بين Hono و Socket.IO على خادمِ Node HTTP واحد.
 *
 * يُمرِّرُ كلَّ طلبٍ لا يخصُّ Socket.IO إلى تطبيقِ Hono، ويتركُ Socket.IO
 * يتولّى ما يخصُّه (مسار `/socket.io/`).
 */
export function createHttpBridge(app: HonoLike, port: number) {
  // عدّادُ الطلباتِ داخلَ الجسرِ وترتيبُها على المقبسِ — يُنشآنِ معَ `onGap` وحدَه.
  let inflight = 0;
  const socketSeq = app.onGap === undefined ? null : new WeakMap<Socket, number>();
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // إزاحةُ كلِّ الطوابعِ من هذهِ اللحظةِ بساعةٍ واحدةٍ — بلا رصدٍ لا تُلتقطُ أصلًا.
    const tEntry = app.onGap === undefined ? null : performance.now();
    const stamps: Partial<Record<"fetchMs" | "writeHeadMs" | "firstWriteMs" | "endMs", number>> =
      {};
    const stamp = (field: "fetchMs" | "writeHeadMs" | "firstWriteMs" | "endMs", at: number) => {
      if (tEntry === null || stamps[field] !== undefined) return;
      stamps[field] = at - tEntry;
    };
    let responseHeaders: Headers | null = null;
    // الحدودُ الأخيرةُ تُسجَّلُ قبلَ أيِّ انتظارٍ: إغلاقٌ مبكرٌ أثناءَ تعليقِ الجسمِ
    // يُبلَّغُ كإغلاقٍ (بما التُقطَ من طوابعٍ حتى لحظتِهِ) لا يُبتلَعُ ولا يُخترعُ لهُ
    // بديلٌ. finish = كُتبتِ آخرُ البياناتِ إلى نظامِ التشغيلِ — ليسَ إثباتَ استلامِ العميلِ.
    if (app.onGap !== undefined && tEntry !== null) {
      const emit = app.onGap;
      inflight += 1;
      const inflightAtEntry = inflight;
      const evAt = (req as unknown as Record<symbol, number | undefined>)[REQUEST_EVENT_AT];
      const requestLeadMs = typeof evAt === "number" ? tEntry - evAt : null;
      const sock = req.socket as Socket | undefined;
      let connSeq: number | null = null;
      if (sock !== undefined && sock !== null && socketSeq !== null) {
        connSeq = (socketSeq.get(sock) ?? 0) + 1;
        socketSeq.set(sock, connSeq);
      }
      const loopOverdueAtEntryMs = app.loopOverdueMs === undefined ? null : app.loopOverdueMs();
      const extra = { requestLeadMs, inflightAtEntry, connSeq, loopOverdueAtEntryMs };
      const base = (): Omit<HttpGapTiming, "finishMs" | "closed" | keyof typeof extra> => ({
        requestId: responseHeaders?.get(REQUEST_ID_HEADER) ?? null,
        method: req.method ?? "",
        pathname: (req.url ?? "/").split("?").at(0) ?? "/",
        fetchMs: stamps.fetchMs ?? null,
        writeHeadMs: stamps.writeHeadMs ?? null,
        firstWriteMs: stamps.firstWriteMs ?? null,
        endMs: stamps.endMs ?? null,
      });
      let settled = false;
      res.on("finish", () => {
        if (settled) return;
        settled = true;
        inflight -= 1;
        emit({ ...base(), finishMs: performance.now() - tEntry, closed: false, ...extra });
      });
      res.on("close", () => {
        if (settled) return;
        settled = true;
        inflight -= 1;
        emit({ ...base(), finishMs: null, closed: true, ...extra });
      });
    }
    try {
      const request = toWebRequest(req, port);
      const response = await app.fetch(request);
      responseHeaders = response.headers;
      stamp("fetchMs", performance.now());
      await writeWebResponse(response, res, tEntry === null ? null : stamp);
    } catch (_error) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: "internal" }));
    }
  };
}

export type { HttpServer };
