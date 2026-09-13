// مسبارُ DEC-06 — خادمٌ منفصلٌ تماماً، مؤقَّتٌ، ويُحذَف بحذفِ مجلَّدِ `probe/`.
//
// حدودُه المقصودة، وهي شرطُ وجوده:
//   * لا PostgreSQL، لا Redis، لا اعتمادياتٍ خارجية على الإطلاق.
//   * لا منطقَ مجالٍ ولا حالةَ عملٍ ولا مصادقةً ولا أيَّ مسٍّ ببوابةِ الإنتاج.
//   * لا يُستورَد منه شيءٌ ولا يستوردُ من `apps/` أو `packages/`.
//   * `node:http` لا `Bun.serve` — لأنّ الملفَّ يجب أن يُشغَّل ويُختبَر بـNode
//     وبـBun على السواء، والمسبارُ يُنشَر خدمةً مستقلّةً لا داخلَ المنتج.
//
// المسارات:
//   GET /         → الصفحة
//   GET /sse      → مجرى SSE: نبضةٌ كلَّ `PROBE_HEARTBEAT_MS`، ورقمُ تسلسلٍ في `id:`
//   GET /healthz  → فحصُ حياةٍ نصّيّ
//
// ولا يحفظ الخادمُ شيئاً على قرصٍ ولا في قاعدة. السجلُّ كلُّه في العميل.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

// افتراضُ الخمسِ ثوانٍ هو المطلوبُ في اختبارِ الجهاز. ويُخفَّض في الفحصِ الذاتيِّ
// وحدَه ليبقى الفحصُ سريعاً — فالمنطقُ المُختبَرُ واحدٌ في الحالتَين.
const HEARTBEAT_MS = Number.parseInt(process.env.PROBE_HEARTBEAT_MS ?? "5000", 10);

// مهلةُ إعادةِ الاتصالِ التي يعلنُها الخادمُ للمتصفّح عبر `retry:`. المتصفّحُ هو
// من يُعيد الاتصالَ في SSE، وهذه هي الطريقةُ الوحيدةُ للتأثيرِ في توقيته.
const RETRY_MS = Number.parseInt(process.env.PROBE_RETRY_MS ?? "3000", 10);

// بعضُ الوسطاءِ العكسيّةِ لا تُمرِّر بايتاً حتى يبلغَ المخزنُ حدّاً. فيُرسَل تعليقٌ
// حاشٍ أوّلَ المجرى ليُكسَر التخزينُ فوراً. وهو تعليقٌ في SSE (`:`) يتجاهلُه العميل.
const PADDING = `:${" ".repeat(2048)}\n\n`;

const SERVER_BOOT_ID = Math.random().toString(36).slice(2, 10);
let streamCounter = 0;
let openStreams = 0;

function nowIso() {
  return new Date().toISOString();
}

function send(res, { event, id, data }) {
  let frame = "";
  if (id !== undefined) frame += `id: ${id}\n`;
  if (event !== undefined) frame += `event: ${event}\n`;
  frame += `data: ${JSON.stringify(data)}\n\n`;
  res.write(frame);
}

function handleSse(req, res) {
  // نقطةُ الاستئناف: المتصفّحُ يُرسل `Last-Event-ID` من تلقاءِ نفسِه عند إعادةِ
  // الاتصال. والمعامَلُ في المسار بديلٌ يدويٌّ للفحصِ فقط.
  //
  // وهذا **ليس replay**: لا سجلَّ أحداثٍ هنا ولا مخزَنَ يُحتفَظ به، فالنبضاتُ التي
  // فاتت أثناءَ الانقطاعِ لا تُعاد إرسالاً. كلُّ ما يفعله المسبار: يقرأ نقطةَ
  // الاستئنافِ التي أرسلها العميل، ويُتابِع الترقيمَ منها، ويُعلِن ما رآه في
  // `connected` — فيُقاس بذلك **تمريرُ نقطةِ الاستئنافِ وسلوكُ العميل**، لا استرجاعُ
  // الفائت. واسترجاعُ الفائتِ يحتاج مخزَنَ أحداثٍ، وهو خارجَ نطاقِ هذا المسبارِ تماماً.
  const headerLast = req.headers["last-event-id"];
  const queryLast = new URL(req.url, "http://probe.local").searchParams.get("lastEventId");
  const parsed = Number.parseInt(headerLast ?? queryLast ?? "0", 10);
  const resumedFrom = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

  streamCounter += 1;
  openStreams += 1;
  const streamNo = streamCounter;

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // يُعطِّل تخزينَ nginx وما يشبهه. لا ضررَ منه حيث لا يُفهَم.
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });

  res.write(PADDING);
  res.write(`retry: ${RETRY_MS}\n\n`);

  // حدثُ الوصلِ لا يحمل `id:` عن قصد، حتى لا يُفسِد نقطةَ استئنافِ المتصفّح.
  send(res, {
    event: "connected",
    data: {
      serverBootId: SERVER_BOOT_ID,
      streamNo,
      resumedFrom,
      lastEventIdHeaderSeen: headerLast ?? null,
      heartbeatMs: HEARTBEAT_MS,
      retryMs: RETRY_MS,
      serverIso: nowIso(),
    },
  });

  let seq = resumedFrom;
  const timer = setInterval(() => {
    seq += 1;
    send(res, {
      id: seq,
      event: "heartbeat",
      data: { seq, streamNo, serverBootId: SERVER_BOOT_ID, serverIso: nowIso() },
    });
  }, HEARTBEAT_MS);

  // الحدثان `close` و`error` يقعان معاً في بعضِ الانقطاعات، فبلا هذا الحارسِ
  // يُنقَص العدّادُ مرّتَين للاتصالِ الواحد ويصير سالباً. كشفَه الفحصُ الذاتي.
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    openStreams -= 1;
    console.log(`[sse] closed stream=${streamNo} lastSeq=${seq} open=${openStreams}`);
  };
  req.on("close", close);
  req.on("error", close);
  res.on("close", close);
  res.on("error", close);

  console.log(
    `[sse] open stream=${streamNo} resumedFrom=${resumedFrom} open=${openStreams} at=${nowIso()}`,
  );
}

async function handlePage(res) {
  try {
    const html = await readFile(join(HERE, "index.html"));
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(html);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`page unavailable: ${String(error)}`);
  }
}

const server = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
    res.end("method not allowed");
    return;
  }

  if (path === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`ok bootId=${SERVER_BOOT_ID} openStreams=${openStreams} heartbeatMs=${HEARTBEAT_MS}`);
    return;
  }

  if (path === "/sse") {
    handleSse(req, res);
    return;
  }

  if (path === "/" || path === "/index.html") {
    void handlePage(res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

// مجرى SSE طويلُ العمرِ لا يجوز أن تقطعَه مهلةُ الخادمِ نفسِه، وإلّا صار القياسُ
// قياساً لمهلتِنا لا لسلوكِ حاويةِ تلغرام.
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;
server.timeout = 0;

server.listen(PORT, HOST, () => {
  console.log(
    `[probe] DEC-06 SSE probe on http://${HOST}:${PORT} bootId=${SERVER_BOOT_ID} heartbeatMs=${HEARTBEAT_MS} retryMs=${RETRY_MS}`,
  );
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
