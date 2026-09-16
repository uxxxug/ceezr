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
 */

import type { Server as HttpServer, IncomingMessage, ServerResponse } from "node:http";

export interface HonoLike {
  fetch: (request: Request, server?: unknown) => Response | Promise<Response>;
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
async function writeWebResponse(response: Response, res: ServerResponse): Promise<void> {
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
  const body = response.body;
  if (body) {
    const reader = body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
}

/**
 * يُنشئُ معالِجَ طلباتٍ يجمعُ بين Hono و Socket.IO على خادمِ Node HTTP واحد.
 *
 * يُمرِّرُ كلَّ طلبٍ لا يخصُّ Socket.IO إلى تطبيقِ Hono، ويتركُ Socket.IO
 * يتولّى ما يخصُّه (مسار `/socket.io/`).
 */
export function createHttpBridge(app: HonoLike, port: number) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const request = toWebRequest(req, port);
      const response = await app.fetch(request);
      await writeWebResponse(response, res);
    } catch (_error) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: "internal" }));
    }
  };
}

export type { HttpServer };
