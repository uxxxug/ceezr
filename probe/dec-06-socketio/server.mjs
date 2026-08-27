// مسبارُ DEC-06 — Socket.IO. خادمٌ منفصلٌ تماماً، مؤقَّتٌ، ويُحذَف بحذفِ مجلَّدِ `probe/`.
//
// وهو المسبارُ الثالثُ في سلسلةٍ واحدة: `probe/dec-06-sse/` ثمّ `probe/dec-06-ws/`
// ثمّ هذا. نفسُ النبضةِ (٥ ثوانٍ)، ونفسُ التسلسلِ المتصاعد، ونفسُ أزرارِ الوسمِ
// السبعة، ونفسُ طريقةِ التصدير — والمتغيّرُ المقصودُ هو الناقل. فما اختلفَ في
// السجلّاتِ الثلاثةِ يُنسَب إلى الناقلِ لا إلى المنهج.
//
// فرقٌ واحدٌ لا يُمكن إخفاؤه ويجب أن يُقرأ كدليلٍ لا كعيبٍ في التصميم: مسبارا
// SSE وWebSocket بصفرِ اعتمادياتٍ — كُتِبت مصافحةُ RFC 6455 وتأطيرُها بيدٍ.
// وSocket.IO **مكتبةٌ**، فلا وجودَ لها بلا تثبيت. وهذا بذاتُه من موادِّ المقارنة:
// كلفةُ الاعتماديةِ ثمنٌ يُحسَب في القرار، لا تفصيلٌ إداريّ. ولذلك لا يوجد
// `package.json` في هذا المجلَّد أيضاً — يبقى المستودعُ بملفِّ حزمةٍ واحدٍ في جذرِه،
// وتُثبَّت المكتبتان بأمرٍ صريحٍ مكتوبٍ في README، فيبقى المسبارُ قابلاً للحذفِ
// بأمرٍ واحدٍ ولا يمسُّ قفلَ الحزمِ ولا مساحاتَ العملِ ولا صورةَ الحاوية.
//
// حدودُه المقصودة، وهي شرطُ وجوده:
//   * لا PostgreSQL، لا Redis، لا Redis Streams Adapter، لا أيِّ محوِّلٍ (adapter)
//     غيرِ المحوِّلِ الافتراضيِّ في الذاكرة.
//   * لا منطقَ مجالٍ ولا حالةَ عملٍ ولا مصادقةً حقيقيةً ولا أيَّ مسٍّ ببوابةِ الإنتاج.
//   * لا يُستورَد منه شيءٌ ولا يستوردُ من `apps/` أو `packages/`.
//   * اعتمادياتُه: `socket.io` للخادم و`socket.io-client` للفحصِ الذاتيِّ وحدَه.
//     أمّا الصفحةُ فتأخذ عميلَها من `/socket.io/socket.io.js` الذي تخدمُه المكتبةُ
//     نفسُها — فلا CDN ولا بناء.
//   * لا يحفظ شيئاً على قرصٍ ولا في قاعدة. السجلُّ كلُّه في العميل.
//
// المسارات:
//   GET  /                        → الصفحة
//   GET  /healthz                 → فحصُ حياةٍ نصّيّ
//   *    /socket.io/*             → المكتبةُ نفسُها (المصافحةُ، النقلُ، وملفُّ العميل)
//
// معامَلاتُ المصافحة (`auth` عند إنشاء العميل) — للفحصِ وللاختبارِ اليدويِّ، لا للإنتاج:
//   lastSeq: N            → يُتابِع الترقيمَ من N (استئنافٌ **يقودُه العميل**)
//   disconnectAfterMs: M  → يقطع الخادمُ الجلسةَ بعد M مللي ثانية
//   closeUnderlying: true → القطعُ يهدم الناقلَ أيضاً (`disconnect(true)`)
//   rejectMe: true        → يرفضُها وسيطُ المصافحةِ بخطأٍ مسمّى، لقياسِ `connect_error`
//
// متغيّراتُ البيئة:
//   PORT (8789) · HOST · PROBE_HEARTBEAT_MS (5000)
//   PROBE_PING_INTERVAL_MS (25000) · PROBE_PING_TIMEOUT_MS (20000)
//     ← نبضةُ Socket.IO الداخلية، وهي **غيرُ** نبضةِ المسبارِ التطبيقية. الفرقُ
//       بينهما مقصودٌ ومُسجَّل: الأولى للمكتبةِ تكشفُ بها موتَ الوصلة، والثانية
//       لنا نقيس بها تسلسلَ الوصولِ في حاويةِ تلغرام.
//   PROBE_TRANSPORTS ("polling,websocket") · PROBE_ALLOW_UPGRADES ("1")
//     ← لصناعةِ حالةِ السقوطِ إلى polling عمداً في الفحصِ الذاتيّ.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

const HERE = dirname(fileURLToPath(import.meta.url));

const PORT = Number.parseInt(process.env.PORT ?? "8789", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

// خمسُ ثوانٍ: نفسُ افتراضِ مسبارَي SSE وWebSocket حتى تبقى المقارنةُ مقارنةَ ناقلٍ
// لا مقارنةَ إعداد. ويُخفَّض في الفحصِ الذاتيِّ وحدَه ليبقى الفحصُ سريعاً.
const HEARTBEAT_MS = Number.parseInt(process.env.PROBE_HEARTBEAT_MS ?? "5000", 10);

// نبضةُ المكتبةِ نفسِها. القيمتان هما افتراضا Socket.IO 4.x، وتُترَكان كما هما
// لأنّ المقصودَ قياسُ سلوكِ المكتبةِ كما تُستخدَم لا كما نُعدُّها.
const PING_INTERVAL_MS = Number.parseInt(process.env.PROBE_PING_INTERVAL_MS ?? "25000", 10);
const PING_TIMEOUT_MS = Number.parseInt(process.env.PROBE_PING_TIMEOUT_MS ?? "20000", 10);

const TRANSPORTS = (process.env.PROBE_TRANSPORTS ?? "polling,websocket")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
const ALLOW_UPGRADES = (process.env.PROBE_ALLOW_UPGRADES ?? "1") !== "0";

// كلُّ نبضةٍ رابعةٍ تُطلَب بإقرار: هذا هو إقرارُ Socket.IO في اتجاهِ خادم→عميل،
// وهو ما لا نظيرَ له في SSE ولا في WebSocket الخام (فيه يُبنى باليد).
const ACK_EVERY = Number.parseInt(process.env.PROBE_ACK_EVERY ?? "4", 10);
const ACK_TIMEOUT_MS = Number.parseInt(process.env.PROBE_ACK_TIMEOUT_MS ?? "4000", 10);

const SERVER_BOOT_ID = Math.random().toString(36).slice(2, 10);
let socketCounter = 0;
let openSockets = 0;
let handshakeRejections = 0;
let engineErrors = 0;

function nowIso() {
  return new Date().toISOString();
}

function positiveInt(value) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ————— HTTP: الصفحةُ والحياةُ فقط. كلُّ ما عدا ذلك للمكتبة.

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

  // مسارُ المكتبةِ يُترَك لها: `socket.io` تُركَّب على الخادمِ نفسِه وتعترضُه أوّلاً.
  if (path.startsWith("/socket.io/")) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
    res.end("method not allowed");
    return;
  }

  if (path === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(
      `ok bootId=${SERVER_BOOT_ID} openSockets=${openSockets} heartbeatMs=${HEARTBEAT_MS} ` +
        `pingIntervalMs=${PING_INTERVAL_MS} pingTimeoutMs=${PING_TIMEOUT_MS} ` +
        `transports=${TRANSPORTS.join("+")} allowUpgrades=${ALLOW_UPGRADES ? 1 : 0} ` +
        `rejections=${handshakeRejections} engineErrors=${engineErrors}`,
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

// ————— Socket.IO: المحوِّلُ الافتراضيُّ في الذاكرة وحدَه. لا Redis ولا أيُّ محوِّلٍ آخر.

const io = new Server(server, {
  serveClient: true,
  transports: TRANSPORTS,
  allowUpgrades: ALLOW_UPGRADES,
  pingInterval: PING_INTERVAL_MS,
  pingTimeout: PING_TIMEOUT_MS,
  // استعادةُ حالةِ الاتصال (`connectionStateRecovery`) ميزةُ Socket.IO تُعيد بثَّ ما
  // فات بعد انقطاعٍ قصير. وهي **غيرُ مذكورةٍ هنا عن قصد**، فتبقى مطفأةً كما هو
  // الافتراض — وذِكرُها ولو بكائنٍ فارغٍ يُشغّلها. تشغيلُها يُخفي الفقدَ الذي جاء
  // المسبارُ ليقيسَه، ويجعل المقارنةَ بمسبارَي SSE وWebSocket غيرَ عادلة. وحضورُها
  // في المكتبةِ يُذكَر في README كخيارٍ متاحٍ لا كخيارٍ مُستخدَم.
});

// وسيطٌ للمصافحة: لا مصادقةَ حقيقيةَ ولا تحقُّقَ من `initData`. وجودُه لغرضٍ واحدٍ
// هو صناعةُ خطأِ مصافحةٍ مسمّى، ليُقاس كيف يُبلِّغ العميلُ عن `connect_error`.
io.use((socket, next) => {
  if (socket.handshake.auth && socket.handshake.auth.rejectMe) {
    handshakeRejections += 1;
    const error = new Error("probe-rejected-by-middleware");
    error.data = { reason: "probe-rejected-by-middleware", serverIso: nowIso() };
    console.log(`[io] handshake-rejected total=${handshakeRejections}`);
    next(error);
    return;
  }
  next();
});

io.engine.on("connection_error", (error) => {
  engineErrors += 1;
  console.log(
    `[io] engine-error code=${error.code} message=${JSON.stringify(String(error.message))} ` +
      `transport=${error.context && error.context.name ? error.context.name : "unknown"}`,
  );
});

io.on("connection", (socket) => {
  socketCounter += 1;
  openSockets += 1;
  const socketNo = socketCounter;

  const auth = socket.handshake.auth ?? {};
  const resumedFrom = positiveInt(auth.lastSeq);

  let seq = resumedFrom;
  let acksReceived = 0; // إقرارُ العميلِ على النبضةِ (بلا رِدّ)
  let lastAckSeq = 0;
  let serverAcksReceived = 0; // إقرارُ العميلِ على طلبٍ من الخادمِ (إقرارُ Socket.IO)
  let serverAckTimeouts = 0;
  let echoRequests = 0;

  // الحارسُ نفسُه المطلوبُ في المسبارَين السابقَين: عدّادٌ يُنقَص مرّتَين للجلسةِ
  // الواحدةِ يجعل المسبارَ يكذب. و`disconnect` في Socket.IO يقع مرّةً في العادة،
  // لكنّ الحارسَ يبقى لأنّ الفحصَ الذاتيَّ يشترط سطرَ إغلاقٍ واحداً لكلِّ جلسة.
  let closed = false;
  let heartbeatTimer = null;
  let disconnectTimer = null;

  const finish = (why, description) => {
    if (closed) return;
    closed = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (disconnectTimer) clearTimeout(disconnectTimer);
    openSockets -= 1;
    console.log(
      `[io] closed socket=${socketNo} id=${socket.id} why=${JSON.stringify(String(why))} ` +
        `description=${JSON.stringify(String(description ?? ""))} lastSeq=${seq} ` +
        `acks=${acksReceived} serverAcks=${serverAcksReceived} ackTimeouts=${serverAckTimeouts} ` +
        `transport=${transportName()} open=${openSockets}`,
    );
  };

  function transportName() {
    try {
      return socket.conn.transport.name;
    } catch {
      return "unknown";
    }
  }

  const initialTransport = transportName();
  let upgradedTo = null;

  // الناقلُ المستخدَمُ فعلاً، ومتى تغيَّر. هذا هو جوهرُ ما يُميِّز هذا المسبارَ:
  // Socket.IO يبدأ في الافتراضِ بـpolling ثمّ يُرقّي إلى WebSocket. فبقاؤه على
  // polling هو **السقوط**، ولا يظهر إلّا إذا سُجِّل الناقلُ في كلِّ جلسةٍ صريحاً.
  socket.conn.on("upgrade", (transport) => {
    upgradedTo = transport.name;
    console.log(`[io] upgrade socket=${socketNo} from=${initialTransport} to=${transport.name}`);
    socket.emit("transport", {
      phase: "upgrade",
      from: initialTransport,
      to: transport.name,
      serverIso: nowIso(),
    });
  });

  socket.conn.on("upgradeError", (error) => {
    console.log(`[io] upgrade-error socket=${socketNo} message=${JSON.stringify(String(error))}`);
    socket.emit("transport", {
      phase: "upgrade-error",
      from: initialTransport,
      message: String(error && error.message ? error.message : error),
      serverIso: nowIso(),
    });
  });

  // أوّلُ رسالةٍ: وصفُ الجلسة. ولا `seq` فيها حتى لا تُحسَب نبضةً.
  socket.emit("connected", {
    serverBootId: SERVER_BOOT_ID,
    socketNo,
    socketId: socket.id,
    resumedFrom,
    // في Socket.IO لا استئنافَ تلقائياً ما لم تُفعَّل `connectionStateRecovery`،
    // وهي مطفأةٌ هنا عن قصد. فالقيمةُ أعلاه جاءت من `auth.lastSeq` كتبَه العميلُ
    // بشيفرتِنا — كما في مسبارِ WebSocket بالضبط، ولا كـ`Last-Event-ID` في SSE
    // الذي يبعثُه المتصفّحُ وحدَه. الفرقُ الثلاثيُّ هذا يُسجَّل في كلِّ جلسة.
    resumeIsClientDriven: true,
    // `socket.recovered` تقول هل استعادت المكتبةُ الجلسةَ. تبقى false لأنّ الاستعادةَ مطفأة.
    recovered: socket.recovered === true,
    connectionStateRecoveryEnabled: false,
    heartbeatMs: HEARTBEAT_MS,
    engine: {
      initialTransport,
      pingIntervalMs: PING_INTERVAL_MS,
      pingTimeoutMs: PING_TIMEOUT_MS,
      allowUpgrades: ALLOW_UPGRADES,
      serverTransports: TRANSPORTS,
      upgrades: ALLOW_UPGRADES && TRANSPORTS.includes("websocket") ? ["websocket"] : [],
    },
    serverIso: nowIso(),
  });

  heartbeatTimer = setInterval(() => {
    if (closed) return;
    seq += 1;
    const payload = {
      seq,
      socketNo,
      serverBootId: SERVER_BOOT_ID,
      transport: transportName(),
      upgradedTo,
      lastAckSeq,
      acksReceived,
      serverAcksReceived,
      serverAckTimeouts,
      echoRequests,
      serverIso: nowIso(),
    };

    // نبضةٌ عاديّةٌ: بثٌّ بلا إقرار — نظيرُ ما يفعله المسباران السابقان.
    socket.emit("hb", payload);

    // وكلُّ نبضةٍ رابعةٍ تُطلَب بإقرارٍ ومهلة: هذه ميزةُ Socket.IO، ونتيجتُها
    // (نجاحٌ أو مهلةٌ منتهية) دليلٌ على أنّ الاتجاهَ الآخرَ حيٌّ أو ميّت.
    if (ACK_EVERY > 0 && seq % ACK_EVERY === 0) {
      socket.timeout(ACK_TIMEOUT_MS).emit("hb-ack-req", { seq, serverIso: nowIso() }, (error) => {
        if (closed) return;
        if (error) {
          serverAckTimeouts += 1;
          console.log(`[io] ack-timeout socket=${socketNo} seq=${seq}`);
          return;
        }
        serverAcksReceived += 1;
      });
    }
  }, HEARTBEAT_MS);

  // إقرارٌ من العميلِ بلا رِدّ: نفسُ رسالةِ مسبارِ WebSocket حرفياً.
  socket.on("ack", (msg) => {
    const value = msg && Number.isFinite(msg.seq) ? msg.seq : null;
    if (value === null) return;
    acksReceived += 1;
    lastAckSeq = value;
  });

  // إقرارُ Socket.IO في اتجاهِ عميل→خادم: العميلُ يبعث ويطلب رِدّاً بدالّةِ إقرار.
  socket.on("echo", (msg, ack) => {
    echoRequests += 1;
    const reply = {
      type: "echo-reply",
      nonce: msg && msg.nonce !== undefined ? msg.nonce : null,
      socketNo,
      transport: transportName(),
      serverIso: nowIso(),
    };
    if (typeof ack === "function") {
      ack(reply);
      return;
    }
    // بلا دالّةِ إقرار: يُرَدُّ بحدثٍ، ليبقى السلوكُ مفهوماً في كلتا الحالتَين.
    socket.emit("echo-reply", reply);
  });

  socket.on("probe-disconnect-me", (msg, ack) => {
    const closeUnderlying = Boolean(msg && msg.closeUnderlying);
    if (typeof ack === "function") ack({ ok: true, closeUnderlying, serverIso: nowIso() });
    console.log(`[io] client-requested-disconnect socket=${socketNo} underlying=${closeUnderlying}`);
    socket.disconnect(closeUnderlying);
  });

  // هدمُ الناقلِ وحدَه دون قطعِ الجلسةِ من طبقةِ Socket.IO. الفرقُ مقصودٌ ومقيس:
  //   `socket.disconnect()`  ⇒ يقرأ العميلُ `io server disconnect` ولا يُعيد المحاولةَ.
  //   `socket.conn.close()`  ⇒ يقرأ العميلُ `transport close` **ويُعيد** المحاولةَ.
  // وهذا التمييزُ هو ما يُقابل رمزَ إغلاقِ WebSocket في المسبارِ السابق، وهو أقربُ
  // ما يُحاكي فقدَ الشبكةِ في الجهاز.
  socket.on("probe-kill-transport", (msg, ack) => {
    if (typeof ack === "function") ack({ ok: true, serverIso: nowIso() });
    console.log(`[io] transport-killed socket=${socketNo} transport=${transportName()}`);
    socket.conn.close();
  });

  const disconnectAfterMs = positiveInt(auth.disconnectAfterMs);
  if (disconnectAfterMs > 0) {
    const closeUnderlying = Boolean(auth.closeUnderlying);
    disconnectTimer = setTimeout(() => {
      console.log(
        `[io] server-initiated-disconnect socket=${socketNo} afterMs=${disconnectAfterMs} ` +
          `underlying=${closeUnderlying}`,
      );
      socket.disconnect(closeUnderlying);
    }, disconnectAfterMs);
  }

  // سببُ الانفصالِ كما تُسمّيه المكتبة، و`description` حين توفّرُها (وهي التي
  // تحمل رمزَ إغلاقِ WebSocket أو خطأَ النقلِ تحتَ الطبقة). تسجيلُ الاثنَين معاً
  // هو المقابلُ لرمزِ الإغلاقِ 1006/4001 في مسبارِ WebSocket.
  socket.on("disconnect", (reason, description) => {
    finish(reason, describeDisconnect(description));
  });

  console.log(
    `[io] open socket=${socketNo} id=${socket.id} resumedFrom=${resumedFrom} ` +
      `transport=${initialTransport} open=${openSockets} at=${nowIso()}`,
  );
});

// `description` قد تكون خطأً أو كائنَ إغلاقٍ حسب الناقل. يُستخرَج منها نصٌّ آمنٌ
// قصيرٌ فقط — لا كائناتٌ كاملةٌ ولا شيءٌ قد يحمل ترويسةً أو مُعرّفاً.
function describeDisconnect(description) {
  if (description === undefined || description === null) return "";
  if (typeof description === "string") return description.slice(0, 120);
  const parts = [];
  if (description.message) parts.push(`message=${String(description.message).slice(0, 80)}`);
  if (description.description) parts.push(`code=${String(description.description).slice(0, 40)}`);
  if (description.context && description.context.name) {
    parts.push(`transport=${String(description.context.name).slice(0, 24)}`);
  }
  return parts.join(" ");
}

// وصلةٌ طويلةُ العمرِ لا يجوز أن تقطعَها مهلةُ الخادمِ نفسِه، وإلّا صار القياسُ
// قياساً لمهلتِنا لا لسلوكِ حاويةِ تلغرام.
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;
server.timeout = 0;

server.listen(PORT, HOST, () => {
  console.log(
    `[probe] DEC-06 Socket.IO probe on http://${HOST}:${PORT} bootId=${SERVER_BOOT_ID} ` +
      `heartbeatMs=${HEARTBEAT_MS} pingIntervalMs=${PING_INTERVAL_MS} ` +
      `pingTimeoutMs=${PING_TIMEOUT_MS} transports=${TRANSPORTS.join("+")} ` +
      `allowUpgrades=${ALLOW_UPGRADES ? 1 : 0}`,
  );
});

const shutdownServer = () => {
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", shutdownServer);
process.on("SIGINT", shutdownServer);
