// مسبارُ DEC-06 — WebSocket. خادمٌ منفصلٌ تماماً، مؤقَّتٌ، ويُحذَف بحذفِ مجلَّدِ `probe/`.
//
// وهو النظيرُ المباشرُ لمسبارِ `probe/dec-06-sse/`: نفسُ النبضةِ، ونفسُ التسلسلِ،
// ونفسُ طريقةِ القياسِ — والمتغيّرُ الوحيدُ هو الناقل. فما اختلفَ في السجلَّين
// يُنسَب إلى الناقلِ لا إلى المنهج.
//
// حدودُه المقصودة، وهي شرطُ وجوده:
//   * لا PostgreSQL، لا Redis، لا Pub/Sub، لا اعتمادياتٍ خارجية على الإطلاق.
//   * لا منطقَ مجالٍ ولا حالةَ عملٍ ولا مصادقةً ولا أيَّ مسٍّ ببوابةِ الإنتاج.
//   * لا يُستورَد منه شيءٌ ولا يستوردُ من `apps/` أو `packages/`.
//   * `node:http` و`node:crypto` وحدَهما، ومصافحةُ RFC 6455 وتأطيرُها مكتوبان هنا
//     بيدٍ — لأنّ إضافةَ مكتبةِ WebSocket تعني اعتماديةً جديدةً في مستودعٍ لا يجوز
//     أن يتّسخَ بمسبارٍ مؤقَّت. والملفُّ يُشغَّل بـNode وبـBun على السواء.
//
// المسارات:
//   GET  /         → الصفحة
//   GET  /healthz  → فحصُ حياةٍ نصّيّ
//   WS   /ws       → مقبسٌ: نبضةٌ كلَّ `PROBE_HEARTBEAT_MS`، ورقمُ تسلسلٍ متصاعد
//
// معامَلاتُ `/ws` — للفحصِ وللاختبارِ اليدويِّ على الجهاز، لا للإنتاج:
//   ?lastSeq=N         → يُتابِع الترقيمَ من N (نظيرُ `Last-Event-ID` **يدوياً**)
//   ?closeAfterMs=M    → يُغلِق الخادمُ المقبسَ بعد M مللي ثانية
//   ?closeCode=C       → رمزُ الإغلاقِ المستخدَم (افتراضاً 4001)
//   ?closeReason=R     → سببُ الإغلاقِ النصّيّ
//
// ولا يحفظ الخادمُ شيئاً على قرصٍ ولا في قاعدة. السجلُّ كلُّه في العميل.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const PORT = Number.parseInt(process.env.PORT ?? "8788", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

// افتراضُ الخمسِ ثوانٍ هو المطلوبُ في اختبارِ الجهاز، وهو نفسُ افتراضِ مسبارِ SSE
// حتى تبقى المقارنةُ مقارنةَ ناقلٍ لا مقارنةَ إعداد. ويُخفَّض في الفحصِ الذاتيِّ
// وحدَه ليبقى الفحصُ سريعاً — فالمنطقُ المُختبَرُ واحدٌ في الحالتَين.
const HEARTBEAT_MS = Number.parseInt(process.env.PROBE_HEARTBEAT_MS ?? "5000", 10);

// نبضةُ بروتوكولٍ (`ping` بإطارِ تحكُّم) يبعثُها الخادمُ ليُقاس هل تردُّ الحاويةُ
// `pong` تلقائياً وهي في الخلفية. وهذا شيءٌ لا نظيرَ له في SSE أصلاً.
const PING_MS = Number.parseInt(process.env.PROBE_PING_MS ?? "15000", 10);

// حدُّ الحمولة: إطارٌ أكبرُ منه يُغلَق بـ1009. حاجزٌ مقصودٌ لا إعدادُ أداء.
const MAX_PAYLOAD = 65536;

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const SERVER_BOOT_ID = Math.random().toString(36).slice(2, 10);
let socketCounter = 0;
let openSockets = 0;

function nowIso() {
  return new Date().toISOString();
}

// ————— تأطيرُ RFC 6455: ترميزٌ للخادم (بلا قناع) وفكٌّ لإطارِ العميل (بقناعٍ إلزامي)

function encodeFrame(opcode, payload) {
  const body = payload ?? Buffer.alloc(0);
  const len = body.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = 0x80 | opcode; // FIN = 1 دائماً: الخادمُ لا يُجزّئ
  return Buffer.concat([header, body]);
}

function closePayload(code, reason) {
  const reasonBuf = Buffer.from(String(reason ?? ""), "utf8");
  const buf = Buffer.alloc(2 + reasonBuf.length);
  buf.writeUInt16BE(code, 0);
  reasonBuf.copy(buf, 2);
  return buf;
}

// يفكُّ ما أمكنَ من إطاراتٍ كاملةٍ في المخزن، ويُعيد الباقيَ كما هو.
// النتيجة: `{ frames, rest, protocolError }`.
function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;

  for (;;) {
    if (buffer.length - offset < 2) break;
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const fin = (b0 & 0x80) !== 0;
    const rsv = b0 & 0x70;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let cursor = offset + 2;

    if (rsv !== 0) return { frames, rest: buffer, protocolError: { code: 1002, reason: "rsv-set" } };

    // إطارُ العميلِ **يجب** أن يكون مقنَّعاً. وغيرُ المقنَّعِ خطأُ بروتوكولٍ صريح.
    if (!masked) {
      return { frames, rest: buffer, protocolError: { code: 1002, reason: "unmasked-client-frame" } };
    }

    if (len === 126) {
      if (buffer.length - cursor < 2) break;
      len = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (len === 127) {
      if (buffer.length - cursor < 8) break;
      const hi = buffer.readUInt32BE(cursor);
      const lo = buffer.readUInt32BE(cursor + 4);
      cursor += 8;
      if (hi !== 0) {
        return { frames, rest: buffer, protocolError: { code: 1009, reason: "payload-too-large" } };
      }
      len = lo;
    }

    if (len > MAX_PAYLOAD) {
      return { frames, rest: buffer, protocolError: { code: 1009, reason: "payload-too-large" } };
    }

    // إطارُ التحكُّم لا يُجزَّأ وحمولتُه ≤ 125 بايت.
    const isControl = opcode >= 0x8;
    if (isControl && (!fin || len > 125)) {
      return { frames, rest: buffer, protocolError: { code: 1002, reason: "bad-control-frame" } };
    }

    if (buffer.length - cursor < 4 + len) break;
    const mask = buffer.subarray(cursor, cursor + 4);
    cursor += 4;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i += 1) payload[i] = buffer[cursor + i] ^ mask[i & 3];
    cursor += len;

    frames.push({ fin, opcode, payload });
    offset = cursor;
  }

  return { frames, rest: buffer.subarray(offset), protocolError: null };
}

// ————— جلسةُ مقبسٍ واحدة

function handleSocket(req, socket, params) {
  socketCounter += 1;
  openSockets += 1;
  const socketNo = socketCounter;

  const parsedLast = Number.parseInt(params.get("lastSeq") ?? "0", 10);
  const resumedFrom = Number.isFinite(parsedLast) && parsedLast > 0 ? parsedLast : 0;

  socket.setNoDelay(true);
  socket.setTimeout(0);

  let seq = resumedFrom;
  let acksReceived = 0;
  let lastAckSeq = 0;
  let pongsReceived = 0;
  let buffer = Buffer.alloc(0);
  // تجزئةُ الرسائل: العميلُ قد يبعث رسالةً على عدّةِ إطارات.
  let fragmentOpcode = null;
  let fragments = [];

  // الحارسُ نفسُه الذي كشفَه الفحصُ الذاتيُّ في مسبارِ SSE: `close` و`error`
  // يقعان معاً في بعضِ الانقطاعات، فبلا هذا الحارسِ يُنقَص العدّادُ مرّتَين
  // للاتصالِ الواحدِ ويصير سالباً. والمسبارُ الذي يكذب في عدّادِه لا يُقاس به.
  let closed = false;
  let heartbeatTimer = null;
  let pingTimer = null;
  let closeTimer = null;

  const finish = (why) => {
    if (closed) return;
    closed = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (pingTimer) clearInterval(pingTimer);
    if (closeTimer) clearTimeout(closeTimer);
    openSockets -= 1;
    console.log(
      `[ws] closed socket=${socketNo} why=${why} lastSeq=${seq} acks=${acksReceived} pongs=${pongsReceived} open=${openSockets}`,
    );
  };

  const write = (frame) => {
    if (closed || socket.destroyed || !socket.writable) return;
    try {
      socket.write(frame);
    } catch {
      finish("write-error");
    }
  };

  const sendJson = (obj) => write(encodeFrame(0x1, Buffer.from(JSON.stringify(obj), "utf8")));

  const shutdown = (code, reason, why) => {
    if (closed) return;
    write(encodeFrame(0x8, closePayload(code, reason)));
    console.log(`[ws] server-close socket=${socketNo} code=${code} reason=${reason}`);
    finish(why);
    // مهلةٌ قصيرةٌ ليخرجَ إطارُ الإغلاقِ قبل هدمِ المقبس.
    setTimeout(() => socket.destroy(), 60).unref();
  };

  socket.on("close", () => finish("socket-close"));
  socket.on("error", () => finish("socket-error"));
  socket.on("end", () => finish("socket-end"));

  // أوّلُ رسالةٍ: وصفُ الجلسة. ولا `seq` فيها حتى لا تُحسَب نبضةً.
  sendJson({
    type: "connected",
    serverBootId: SERVER_BOOT_ID,
    socketNo,
    resumedFrom,
    // في WebSocket لا ترويسةَ استئنافٍ يبعثُها المتصفّحُ من تلقاءِ نفسِه — لا نظيرَ
    // لـ`Last-Event-ID` في البروتوكول. فالقيمةُ أعلاه جاءت من معامَلٍ كتبَه العميلُ
    // بشيفرتِنا. وهذا فرقٌ جوهريٌّ يُسجَّل صريحاً في كلِّ جلسة.
    resumeIsClientDriven: true,
    heartbeatMs: HEARTBEAT_MS,
    pingMs: PING_MS,
    serverIso: nowIso(),
  });

  heartbeatTimer = setInterval(() => {
    seq += 1;
    sendJson({
      type: "heartbeat",
      seq,
      socketNo,
      serverBootId: SERVER_BOOT_ID,
      lastAckSeq,
      acksReceived,
      pongsReceived,
      serverIso: nowIso(),
    });
  }, HEARTBEAT_MS);

  if (PING_MS > 0) {
    pingTimer = setInterval(() => {
      write(encodeFrame(0x9, Buffer.from(`p${Date.now()}`, "utf8")));
    }, PING_MS);
  }

  const closeAfterMs = Number.parseInt(params.get("closeAfterMs") ?? "0", 10);
  if (Number.isFinite(closeAfterMs) && closeAfterMs > 0) {
    const code = Number.parseInt(params.get("closeCode") ?? "4001", 10);
    const reason = params.get("closeReason") ?? "probe-server-initiated-close";
    closeTimer = setTimeout(
      () => shutdown(Number.isFinite(code) ? code : 4001, reason, "server-initiated"),
      closeAfterMs,
    );
  }

  socket.on("data", (chunk) => {
    if (closed) return;
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    const { frames, rest, protocolError } = decodeFrames(buffer);
    buffer = rest;

    for (const frame of frames) {
      if (frame.opcode === 0x8) {
        // إغلاقٌ من العميل: يُقرأ الرمزُ والسببُ ويُسجَّلان — وهذا بذاتُه مقياس،
        // فالحاوياتُ تختلف في الرمزِ الذي تُغلِق به عند التصغيرِ أو قطعِ الشبكة.
        const code = frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : null;
        const reason = frame.payload.length > 2 ? frame.payload.subarray(2).toString("utf8") : "";
        console.log(
          `[ws] client-close socket=${socketNo} code=${code ?? "none"} reason=${JSON.stringify(reason)}`,
        );
        if (!closed) {
          write(encodeFrame(0x8, closePayload(code ?? 1000, "ack")));
          finish("client-close");
          setTimeout(() => socket.destroy(), 60).unref();
        }
        return;
      }

      if (frame.opcode === 0x9) {
        // `ping` من العميلِ يُقابَل بـ`pong` بنفسِ الحمولة، كما يوجب البروتوكول.
        write(encodeFrame(0xa, frame.payload));
        continue;
      }

      if (frame.opcode === 0xa) {
        pongsReceived += 1;
        continue;
      }

      // إطاراتُ البيانات: 0x1 نصّ · 0x2 ثنائيّ · 0x0 متابعةُ تجزئة.
      if (frame.opcode === 0x1 || frame.opcode === 0x2) {
        if (fragmentOpcode !== null) {
          shutdown(1002, "interleaved-data-frame", "protocol-error");
          return;
        }
        if (frame.fin) {
          onMessage(frame.payload.toString("utf8"));
        } else {
          fragmentOpcode = frame.opcode;
          fragments = [frame.payload];
        }
        continue;
      }

      if (frame.opcode === 0x0) {
        if (fragmentOpcode === null) {
          shutdown(1002, "continuation-without-start", "protocol-error");
          return;
        }
        fragments.push(frame.payload);
        if (frame.fin) {
          const whole = Buffer.concat(fragments);
          fragmentOpcode = null;
          fragments = [];
          onMessage(whole.toString("utf8"));
        }
        continue;
      }

      shutdown(1002, `unknown-opcode-${frame.opcode}`, "protocol-error");
      return;
    }

    if (protocolError) {
      shutdown(protocolError.code, protocolError.reason, "protocol-error");
    }
  });

  function onMessage(text) {
    let msg = null;
    try {
      msg = JSON.parse(text);
    } catch {
      sendJson({ type: "parse-error", got: text.slice(0, 120) });
      return;
    }

    // الاتجاهُ المعاكس — وهو ما لا يقدر عليه SSE أصلاً: العميلُ يُقِرُّ بالنبضة،
    // والخادمُ يُعلِن آخرَ إقرارٍ في النبضةِ التالية. فيُقاس بذلك أنّ القناةَ
    // حيّةٌ في الاتجاهَين لا في اتجاهٍ واحد.
    if (msg && msg.type === "ack" && Number.isFinite(msg.seq)) {
      acksReceived += 1;
      lastAckSeq = msg.seq;
      return;
    }

    if (msg && msg.type === "echo") {
      sendJson({ type: "echo-reply", nonce: msg.nonce ?? null, serverIso: nowIso() });
      return;
    }

    sendJson({ type: "unknown-message", got: (msg && msg.type) ?? null });
  }

  console.log(
    `[ws] open socket=${socketNo} resumedFrom=${resumedFrom} open=${openSockets} at=${nowIso()}`,
  );
}

// ————— HTTP: الصفحةُ والحياةُ، ثم ترقيةُ الاتصالِ إلى WebSocket

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
    res.end(
      `ok bootId=${SERVER_BOOT_ID} openSockets=${openSockets} heartbeatMs=${HEARTBEAT_MS} pingMs=${PING_MS}`,
    );
    return;
  }

  if (path === "/" || path === "/index.html") {
    void handlePage(res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://probe.local");
  const key = req.headers["sec-websocket-key"];
  const version = req.headers["sec-websocket-version"];
  const upgradeHeader = String(req.headers.upgrade ?? "").toLowerCase();

  const reject = (status, text) => {
    socket.write(
      `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
    socket.destroy();
  };

  if (url.pathname !== "/ws") return reject(404, "Not Found");
  if (upgradeHeader !== "websocket") return reject(400, "Bad Request");
  if (typeof key !== "string" || key.length === 0) return reject(400, "Bad Request");
  if (version !== undefined && String(version) !== "13") return reject(426, "Upgrade Required");

  const accept = createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  handleSocket(req, socket, url.searchParams);

  // بايتاتٌ وصلت مع الترقيةِ نفسِها تُعاد إلى المقبسِ ليقرأها معالجُ البيانات.
  if (head && head.length > 0) socket.unshift(head);
});

// مقبسٌ طويلُ العمرِ لا يجوز أن تقطعَه مهلةُ الخادمِ نفسِه، وإلّا صار القياسُ
// قياساً لمهلتِنا لا لسلوكِ حاويةِ تلغرام.
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;
server.timeout = 0;

server.listen(PORT, HOST, () => {
  console.log(
    `[probe] DEC-06 WS probe on http://${HOST}:${PORT} bootId=${SERVER_BOOT_ID} heartbeatMs=${HEARTBEAT_MS} pingMs=${PING_MS}`,
  );
});

const shutdownServer = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", shutdownServer);
process.on("SIGINT", shutdownServer);
