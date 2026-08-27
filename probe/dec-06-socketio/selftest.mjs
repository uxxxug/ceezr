// فحصٌ ذاتيٌّ لمسبارِ Socket.IO — يتحقّق أنّ المسبارَ نفسَه سليم، لا أنّ Socket.IO
// يعمل في تلغرام. يُشغَّل: `node probe/dec-06-socketio/selftest.mjs` (أو بـbun).
//
// شرطُ التشغيل: تثبيتُ المكتبتَين في هذا المجلَّد أوّلاً — ولا `package.json` هنا
// عن قصد (انظر README):
//   npm install --prefix probe/dec-06-socketio --no-save --no-package-lock \
//     socket.io@4.8.3 socket.io-client@4.8.3
//
// يرفع نبضةَ الخادمِ إلى 300ms و`pingInterval` إلى 1000ms ليبقى الفحصُ قصيراً —
// والمنطقُ المُختبَرُ واحدٌ في الحالتَين.
//
// وحدُّه الصريح: هذا الفحصُ يقيس الخادمَ والصفحةَ في Node على هذه الآلة.
// **ولا يقول شيئاً عن سلوكِ iOS أو Android أو حاويةِ ويبِ تلغرام.**

import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { get } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8793; // مسبارُ SSE 8787/8791 · WebSocket 8788/8792 · وهذا 8789/8793
const PORT_NO_UPGRADE = 8794; // خادمٌ ثانٍ يمنع الترقية، لصناعةِ حالةِ السقوط
const BEAT = 300;
const BASE = `http://127.0.0.1:${PORT}`;
const BASE_NO_UPGRADE = `http://127.0.0.1:${PORT_NO_UPGRADE}`;

let passed = 0;
const failures = [];

function check(name, condition, got) {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(`${name} — got: ${JSON.stringify(got)}`);
    console.log(`  ❌ ${name} — got: ${JSON.stringify(got)}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchText(base, path) {
  return new Promise((resolve, reject) => {
    get(`${base}${path}`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

async function waitUntil(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > deadline) {
      console.log(`  … انتهت مهلةُ الانتظار: ${label}`);
      return false;
    }
    await sleep(25);
  }
}

// ————— عميلُ فحصٍ يُسجّل كلَّ ما يهمّ: الناقلَ، والترقيةَ، وسببَ الانفصال

function makeClient(base, options, { ignoreServerAck = false } = {}) {
  const socket = io(base, {
    transports: ["polling", "websocket"],
    reconnection: false,
    timeout: 5000,
    ...options,
  });

  const rec = {
    socket,
    startedAt: Date.now(),
    connectedAt: null,
    connectMs: null,
    connected: null, // حمولةُ حدثِ `connected`
    hb: [],
    ackRequests: [],
    upgrades: [],
    upgradeErrors: [],
    engineCloses: [],
    disconnects: [],
    connectErrors: [],
    transportAtConnect: null,
    transportAtOpen: null, // أوّلُ ناقلٍ فعلاً، يُقرأ قبلَ أيِّ ترقية
    boundEngine: null,
  };

  const bindEngine = () => {
    const engine = socket.io.engine;
    if (!engine || engine === rec.boundEngine) return;
    rec.boundEngine = engine;
    engine.on("upgrade", (transport) => rec.upgrades.push(transport.name));
    engine.on("upgradeError", (error) => rec.upgradeErrors.push(String(error && error.message)));
    engine.on("close", (reason) => rec.engineCloses.push(String(reason)));
  };

  // الربطُ على `open` من المُدير لا على `connect` من المقبس: الترقيةُ على الحلقةِ
  // المحليةِ قد تكتمل قبلَ `connect`، فيُفلت الحدثُ ويُقاس الناقلُ خطأً.
  socket.io.on("open", () => {
    bindEngine();
    try {
      rec.transportAtOpen = socket.io.engine.transport.name;
    } catch {
      rec.transportAtOpen = null;
    }
  });

  socket.on("connect", () => {
    rec.connectedAt = Date.now();
    rec.connectMs = rec.connectedAt - rec.startedAt;
    bindEngine();
    rec.transportAtConnect = socket.io.engine.transport.name;
  });
  socket.on("connected", (payload) => {
    rec.connected = payload;
  });
  socket.on("hb", (payload) => {
    rec.hb.push(payload);
    socket.emit("ack", { seq: payload.seq });
  });
  socket.on("hb-ack-req", (payload, ack) => {
    rec.ackRequests.push(payload);
    if (!ignoreServerAck && typeof ack === "function") {
      ack({ ok: true, clientIso: new Date().toISOString() });
    }
  });
  socket.on("disconnect", (reason, description) => {
    rec.disconnects.push({ reason, description: description ? String(description.message ?? description) : null });
  });
  socket.on("connect_error", (error) => {
    rec.connectErrors.push({ message: String(error.message), data: error.data ?? null });
  });

  rec.transport = () => {
    try {
      return socket.io.engine.transport.name;
    } catch {
      return null;
    }
  };
  rec.waitConnected = (ms = 4000) => waitUntil(() => rec.connected !== null, ms, "connected");
  rec.waitBeats = (n, ms = 4000) => waitUntil(() => rec.hb.length >= n, ms, `${n} beats`);
  rec.close = () => socket.close();
  return rec;
}

// ————— [0] العزل: يُقرأ من النصِّ نفسِه لا من النوايا

console.log("— فحص مسبار Socket.IO الذاتي —\n");
console.log("[0] العزل");

const serverSrc = readFileSync(join(HERE, "server.mjs"), "utf8");
const pageSrc = readFileSync(join(HERE, "index.html"), "utf8");

// التعليقاتُ تُنزَع قبل الفحص: أسماءُ الممنوعاتِ مذكورةٌ فيها **لنفيها**،
// والمقصودُ منعُ استعمالِها في الشيفرةِ المنفَّذة لا ذكرُها في الوصف.
const strip = (src) =>
  src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
const codeServer = strip(serverSrc);
const codePage = strip(pageSrc);
const both = `${codeServer}\n${codePage}`;

for (const forbidden of ["postgres", "pg_notify", "redis", "upstash", "supabase", "grammy"]) {
  check(`لا استعمال لـ${forbidden} في الشيفرة`, !both.toLowerCase().includes(forbidden), forbidden);
}
check("لا محوِّل (adapter) خارج المحوِّل الافتراضي", !both.includes("createAdapter"), "createAdapter");
check(
  "لا استيراد من apps/ أو packages/",
  !/from\s+["'][^"']*(apps|packages)\//.test(serverSrc),
  "import path",
);
const serverImports = [...serverSrc.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
check(
  "اعتماديةُ الخادمِ الوحيدةُ socket.io",
  serverImports.length > 0 &&
    serverImports.every((m) => m.startsWith("node:") || m === "socket.io"),
  serverImports,
);
const installed = readdirSync(join(HERE, "node_modules")).filter((d) => !d.startsWith("."));
const scoped = installed.includes("@socket.io")
  ? readdirSync(join(HERE, "node_modules", "@socket.io")).map((d) => `@socket.io/${d}`)
  : [];
const bannedDeps = ["pg", "postgres", "redis", "ioredis"];
const bannedFound = installed
  .filter((d) => bannedDeps.includes(d))
  .concat(scoped.filter((d) => d.includes("redis") || d.includes("postgres")));
check("لا حزمةَ قاعدةِ بياناتٍ ولا Redis في المُثبَّت", bannedFound.length === 0, bannedFound);
check(
  "المُثبَّت يحوي socket.io وsocket.io-client",
  installed.includes("socket.io") && installed.includes("socket.io-client"),
  installed.length,
);
check("الصفحة تأخذ العميل من الخادم لا من CDN", pageSrc.includes('src="/socket.io/socket.io.js"'), false);
check("الصفحة تسجّل الناقل المستخدَم", codePage.includes("engine.transport.name"), false);
check("الصفحة تسجّل السقوط إلى polling", codePage.includes('add("fallback"'), false);
check("الصفحة تسجّل سبب الانفصال", codePage.includes("reason: String(reason)"), false);
check("الصفحة تسجّل وقت بدء الاتصال ووقت نجاحه", codePage.includes("connectedAtIso"), false);
check(
  "لا كتابة لقيمة initData الخام في الصفحة",
  !/initData\s*[,:]\s*tg\.initData/.test(codePage),
  false,
);
check("لا كتابة لـlocation.href في السجل", !codePage.includes("location.href"), "location.href");
check("لا كتابة لـlocation.hash في السجل", !codePage.includes("location.hash"), "location.hash");
check(
  "لا كتابة لـlocation.search في السجل",
  (codePage.match(/location\.search/g) || []).length <= 1,
  "location.search",
);
check("الصفحة فيها زر التصدير", pageSrc.includes('id="download"'), false);
check(
  "أزرارُ الحالات السبع كاملة",
  ["CASE-1", "CASE-2", "CASE-3", "CASE-4", "CASE-5", "CASE-6", "CASE-7"].every((c) =>
    pageSrc.includes(c),
  ),
  false,
);
check(
  "استعادةُ حالةِ الاتصال مطفأة (غيرُ مذكورةٍ أصلاً)",
  !codeServer.includes("connectionStateRecovery:"),
  "connectionStateRecovery",
);

// ————— تشغيلُ الخادمَين

const child = spawn(process.execPath, [join(HERE, "server.mjs")], {
  env: {
    ...process.env,
    PORT: String(PORT),
    PROBE_HEARTBEAT_MS: String(BEAT),
    PROBE_PING_INTERVAL_MS: "1000",
    PROBE_PING_TIMEOUT_MS: "2000",
    PROBE_ACK_EVERY: "2",
    PROBE_ACK_TIMEOUT_MS: "1200",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const childNoUpgrade = spawn(process.execPath, [join(HERE, "server.mjs")], {
  env: {
    ...process.env,
    PORT: String(PORT_NO_UPGRADE),
    PROBE_HEARTBEAT_MS: String(BEAT),
    PROBE_ALLOW_UPGRADES: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOut = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (c) => {
  serverOut += c;
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (c) => {
  serverOut += c;
});
childNoUpgrade.stdout.on("data", () => {});
childNoUpgrade.stderr.on("data", () => {});

await sleep(900);

try {
  // ————— [1] الحياة والصفحة وملفُّ العميل

  console.log("\n[1] الحياة والصفحة وملفُّ العميل");
  const health = await fetchText(BASE, "/healthz");
  check("healthz = 200", health.status === 200, health.status);
  check("healthz يذكر bootId", /bootId=[a-z0-9]{4,}/.test(health.body), health.body);
  check("healthz يذكر النبضة المضبوطة", health.body.includes(`heartbeatMs=${BEAT}`), health.body);
  check("healthz يذكر النواقل المسموحة", health.body.includes("transports=polling+websocket"), health.body);
  check("healthz يذكر الترقية مسموحة", health.body.includes("allowUpgrades=1"), health.body);

  const page = await fetchText(BASE, "/");
  check("الصفحة = 200", page.status === 200, page.status);
  check("الصفحة عربية RTL", page.body.includes('dir="rtl"'), false);
  const clientJs = await fetchText(BASE, "/socket.io/socket.io.js");
  check("ملفُّ عميل Socket.IO مخدومٌ محلياً = 200", clientJs.status === 200, clientJs.status);
  check(
    "ملفُّ العميل جافاسكربت",
    String(clientJs.headers["content-type"] || "").includes("javascript"),
    clientJs.headers["content-type"],
  );
  const notFound = await fetchText(BASE, "/nope");
  check("مسارٌ مجهول = 404", notFound.status === 404, notFound.status);

  const noUpHealth = await fetchText(BASE_NO_UPGRADE, "/healthz");
  check("الخادمُ المانعُ للترقيةِ حيٌّ ويُعلِن ذلك", noUpHealth.body.includes("allowUpgrades=0"), noUpHealth.body);

  // ————— [2] الاتصال ووصفُ الجلسة

  console.log("\n[2] الاتصال ووصفُ الجلسة");
  const c1 = makeClient(BASE, {});
  check("الاتصال نجح", await c1.waitConnected(), c1.connectErrors);
  check("للجلسة مُعرِّفٌ نصّيّ", typeof c1.socket.id === "string" && c1.socket.id.length > 5, c1.socket.id);
  check("زمنُ الاتصالِ مقيسٌ وموجب", typeof c1.connectMs === "number" && c1.connectMs >= 0, c1.connectMs);
  check("وصفُ الجلسة يحمل bootId", Boolean(c1.connected && c1.connected.serverBootId), c1.connected);
  check("وصفُ الجلسة يحمل رقمَ الجلسة", c1.connected.socketNo >= 1, c1.connected.socketNo);
  check("النبضةُ المُعلَنةُ تساوي المضبوطة", c1.connected.heartbeatMs === BEAT, c1.connected.heartbeatMs);
  check("الاستئنافُ يقودُه العميلُ صريحاً", c1.connected.resumeIsClientDriven === true, c1.connected);
  check("لا استعادةَ حالةِ اتصالٍ من المكتبة", c1.connected.recovered === false, c1.connected.recovered);
  check(
    "استعادةُ الحالةِ مُعلَنةٌ مطفأة",
    c1.connected.connectionStateRecoveryEnabled === false,
    c1.connected,
  );
  check(
    "وصفُ الجلسة يذكر نبضةَ المكتبةِ منفصلةً",
    c1.connected.engine && c1.connected.engine.pingIntervalMs === 1000,
    c1.connected.engine,
  );

  // ————— [3] النبضةُ والتسلسل

  console.log("\n[3] النبضةُ والتسلسلُ المتصاعد");
  check("وصلت أربعُ نبضاتٍ على الأقل", await c1.waitBeats(4), c1.hb.length);
  const seqs = c1.hb.map((h) => h.seq);
  check("التسلسلُ يبدأ من 1", seqs[0] === 1, seqs[0]);
  check(
    "التسلسلُ متصاعدٌ بواحدٍ بلا فجوة",
    seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1),
    seqs,
  );
  check("كلُّ النبضاتِ من نفسِ الجلسة", new Set(c1.hb.map((h) => h.socketNo)).size === 1, c1.hb.length);
  check(
    "كلُّ نبضةٍ تحمل الناقلَ المستخدَمَ فعلاً",
    c1.hb.every((h) => h.transport === "polling" || h.transport === "websocket"),
    c1.hb.map((h) => h.transport),
  );

  // ————— [4] عميل→خادم بلا إقرار (نفسُ رسالةِ مسبارِ WebSocket)

  console.log("\n[4] رسالةُ عميل→خادم بلا إقرار");
  await c1.waitBeats(6, 4000);
  const withAck = c1.hb.find((h) => h.lastAckSeq > 0);
  check("الخادمُ يُعلِن آخرَ إقرارٍ وصلَه", Boolean(withAck), c1.hb.map((h) => h.lastAckSeq));
  check("عدّادُ الإقراراتِ يتقدّم", (withAck ? withAck.acksReceived : 0) > 0, withAck);

  // ————— [5] إقرارُ Socket.IO في اتجاهِ عميل→خادم

  console.log("\n[5] إقرارٌ عميل→خادم (acknowledgement)");
  const echoReply = await new Promise((resolve) => {
    c1.socket.timeout(3000).emit("echo", { nonce: "n-42" }, (error, reply) => {
      resolve(error ? { error: String(error.message) } : reply);
    });
  });
  check("الرِّدُّ وصلَ عبر دالّةِ الإقرار", echoReply && echoReply.type === "echo-reply", echoReply);
  check("الرِّدُّ يُعيد نفسَ الرقمِ العابر", echoReply && echoReply.nonce === "n-42", echoReply);
  check("الرِّدُّ يذكر ناقلَ الخادمِ وقتَه", Boolean(echoReply && echoReply.transport), echoReply);
  await c1.waitBeats(c1.hb.length + 2, 3000);
  check(
    "الخادمُ عدَّ طلبَ الإقرار",
    c1.hb[c1.hb.length - 1].echoRequests >= 1,
    c1.hb[c1.hb.length - 1],
  );

  // ————— [6] إقرارُ Socket.IO في اتجاهِ خادم→عميل، ومهلتُه حين لا يردُّ العميل

  console.log("\n[6] إقرارٌ خادم→عميل ومهلتُه");
  check("الخادمُ طلبَ إقراراً على الأقلِّ مرّةً", c1.ackRequests.length >= 1, c1.ackRequests.length);
  const acked = c1.hb.find((h) => h.serverAcksReceived > 0);
  check("إقرارُ العميلِ وصلَ الخادمَ", Boolean(acked), c1.hb.map((h) => h.serverAcksReceived));
  check("لا مهلةَ إقرارٍ منتهيةٌ مع عميلٍ يردّ", c1.hb.every((h) => h.serverAckTimeouts === 0), true);

  const cSilent = makeClient(BASE, {}, { ignoreServerAck: true });
  await cSilent.waitConnected();
  await waitUntil(() => cSilent.hb.some((h) => h.serverAckTimeouts > 0), 6000, "ack timeout");
  check(
    "عميلٌ لا يردُّ ⇒ تُسجَّل مهلةُ إقرارٍ منتهية",
    cSilent.hb.some((h) => h.serverAckTimeouts > 0),
    cSilent.hb.map((h) => h.serverAckTimeouts),
  );
  check("سجلُّ الخادمِ يذكر مهلةَ الإقرار", serverOut.includes("[io] ack-timeout"), false);
  cSilent.close();

  // ————— [7] الاستئنافُ يقودُه العميل

  console.log("\n[7] الاستئنافُ من نقطةٍ يُمرّرُها العميل");
  const cResume = makeClient(BASE, { auth: { lastSeq: 57 } });
  await cResume.waitConnected();
  check("الخادمُ أقرَّ بنقطةِ الاستئناف", cResume.connected.resumedFrom === 57, cResume.connected);
  await cResume.waitBeats(1, 3000);
  check("النبضةُ الأولى بعد الاستئناف = 58", cResume.hb[0].seq === 58, cResume.hb[0]);
  cResume.close();

  const cFresh = makeClient(BASE, {});
  await cFresh.waitConnected();
  check("بلا نقطةِ استئناف: يبدأ من الصفر", cFresh.connected.resumedFrom === 0, cFresh.connected);
  await cFresh.waitBeats(1, 3000);
  check("النبضةُ الأولى في جلسةٍ جديدة = 1", cFresh.hb[0].seq === 1, cFresh.hb[0]);
  cFresh.close();

  // ————— [8] الناقلُ فعلاً، والترقيةُ، والسقوطُ إلى polling

  console.log("\n[8] الناقلُ والترقيةُ والسقوطُ");
  const cUp = makeClient(BASE, {});
  await cUp.waitConnected();
  check("الافتراضُ يبدأ بـpolling", cUp.transportAtOpen === "polling", cUp.transportAtOpen);
  await waitUntil(() => cUp.upgrades.length > 0, 4000, "upgrade");
  check("الترقيةُ إلى WebSocket حصلت", cUp.upgrades.includes("websocket"), cUp.upgrades);
  check("الناقلُ بعد الترقيةِ WebSocket", cUp.transport() === "websocket", cUp.transport());
  check("سجلُّ الخادمِ يُدوّن الترقية", /\[io\] upgrade socket=\d+ from=polling to=websocket/.test(serverOut), false);
  cUp.close();

  const cWsOnly = makeClient(BASE, { transports: ["websocket"] });
  await cWsOnly.waitConnected();
  check("بـWebSocket وحدَه: لا polling أصلاً", cWsOnly.transportAtOpen === "websocket", cWsOnly.transportAtOpen);
  check("بـWebSocket وحدَه: لا حدثَ ترقية", cWsOnly.upgrades.length === 0, cWsOnly.upgrades);
  cWsOnly.close();

  const cPollOnly = makeClient(BASE, { transports: ["polling"] });
  await cPollOnly.waitConnected();
  await cPollOnly.waitBeats(3, 4000);
  check("بـpolling وحدَه: الجلسةُ تعمل", cPollOnly.hb.length >= 3, cPollOnly.hb.length);
  check("بـpolling وحدَه: الناقلُ يبقى polling", cPollOnly.transport() === "polling", cPollOnly.transport());
  check(
    "الخادمُ يُبلِّغ الناقلَ الحقيقيَّ في النبضة",
    cPollOnly.hb.every((h) => h.transport === "polling"),
    cPollOnly.hb.map((h) => h.transport),
  );
  cPollOnly.close();

  // خادمٌ يمنع الترقية: هذه هي حالةُ السقوطِ الحقيقية — العميلُ يطلب الترقيةَ ولا يجدُها.
  const cFallback = makeClient(BASE_NO_UPGRADE, {});
  await cFallback.waitConnected();
  await sleep(1500);
  check("خادمٌ يمنع الترقية ⇒ البدايةُ polling", cFallback.transportAtOpen === "polling", cFallback.transportAtOpen);
  check("خادمٌ يمنع الترقية ⇒ لا ترقيةَ حصلت", cFallback.upgrades.length === 0, cFallback.upgrades);
  check("خادمٌ يمنع الترقية ⇒ البقاءُ على polling", cFallback.transport() === "polling", cFallback.transport());
  check(
    "وصفُ الجلسةِ يُعلِن أنّ الترقيةَ ممنوعة",
    cFallback.connected.engine.allowUpgrades === false &&
      cFallback.connected.engine.upgrades.length === 0,
    cFallback.connected.engine,
  );
  await cFallback.waitBeats(2, 3000);
  check("الجلسةُ تعمل على polling وحدَه", cFallback.hb.length >= 2, cFallback.hb.length);
  cFallback.close();

  // ————— [9] الانفصالُ وسببُه

  console.log("\n[9] الانفصالُ وسببُه كما تُسمّيه المكتبة");
  const cServerCut = makeClient(BASE, { auth: { disconnectAfterMs: 400 } });
  await cServerCut.waitConnected();
  await waitUntil(() => cServerCut.disconnects.length > 0, 4000, "server disconnect");
  check(
    "قطعٌ من الخادم ⇒ السببُ io server disconnect",
    cServerCut.disconnects[0] && cServerCut.disconnects[0].reason === "io server disconnect",
    cServerCut.disconnects,
  );
  await sleep(250); // مخرجُ الخادمِ يُقرأ على دفعاتٍ؛ لا يُفحَص قبلَ وصولِه
  check("سجلُّ الخادمِ يُدوّن القطعَ المتعمَّد", serverOut.includes("[io] server-initiated-disconnect"), false);
  check(
    "سجلُّ الخادمِ يُدوّن سببَ الإغلاقِ نصّاً",
    /\[io\] closed socket=\d+ id=\S+ why="server namespace disconnect"/.test(serverOut),
    false,
  );
  cServerCut.close();

  const cSelfCut = makeClient(BASE, {});
  await cSelfCut.waitConnected();
  cSelfCut.socket.disconnect();
  await waitUntil(() => cSelfCut.disconnects.length > 0, 3000, "client disconnect");
  check(
    "قطعٌ من العميل ⇒ السببُ io client disconnect",
    cSelfCut.disconnects[0].reason === "io client disconnect",
    cSelfCut.disconnects,
  );
  await sleep(200);
  check(
    "الخادمُ يقرأ سببَ قطعِ العميل",
    serverOut.includes('why="client namespace disconnect"'),
    false,
  );

  // تمييزٌ مقصودٌ بين هدمٍ من جهةِ العميل وهدمٍ من جهةِ الخادم: المكتبةُ
  // تُسمّيهما باسمين مختلفَين، والتمييزُ نفسُه دليلٌ لقراءةِ سجلاتِ الأجهزة.
  const cAbrupt = makeClient(BASE, {});
  await cAbrupt.waitConnected();
  await cAbrupt.waitBeats(2, 3000);
  cAbrupt.socket.io.engine.close(); // هدمٌ من جهةِ العميل
  await waitUntil(() => cAbrupt.disconnects.length > 0, 4000, "abrupt");
  check(
    "هدمٌ من جهةِ العميل ⇒ السببُ forced close",
    cAbrupt.disconnects[0].reason === "forced close",
    cAbrupt.disconnects,
  );
  check("إغلاقُ الناقلِ مُسجَّلٌ على مستوى المحرّك", cAbrupt.engineCloses.length >= 1, cAbrupt.engineCloses);

  const cKilled = makeClient(BASE, {});
  await cKilled.waitConnected();
  cKilled.socket.emit("probe-kill-transport");
  await waitUntil(() => cKilled.disconnects.length > 0, 4000, "transport close");
  check(
    "هدمُ الناقلِ من الخادم ⇒ السببُ transport close",
    cKilled.disconnects[0].reason === "transport close",
    cKilled.disconnects,
  );
  await sleep(250);
  check("سجلُّ الخادمِ يُدوّن هدمَ الناقل", serverOut.includes("[io] transport-killed"), false);
  check(
    "الخادمُ يقرأ سببَ الإغلاقِ transport close",
    /why="transport close"/.test(serverOut),
    false,
  );
  cKilled.close();
  cAbrupt.close();

  // ————— [10] خطأُ المصافحة

  console.log("\n[10] خطأُ المصافحةِ يُبلَّغ بسببٍ مسمّى");
  const cReject = makeClient(BASE, { auth: { rejectMe: true } });
  await waitUntil(() => cReject.connectErrors.length > 0, 4000, "connect_error");
  check("الرفضُ يُبلَّغ عبر connect_error", cReject.connectErrors.length >= 1, cReject.connectErrors);
  check(
    "نصُّ الخطأِ هو الذي أرسلَه الوسيط",
    cReject.connectErrors[0].message === "probe-rejected-by-middleware",
    cReject.connectErrors[0],
  );
  check(
    "بياناتُ الخطأِ الإضافيةُ تصل",
    cReject.connectErrors[0].data && cReject.connectErrors[0].data.reason === "probe-rejected-by-middleware",
    cReject.connectErrors[0].data,
  );
  cReject.close();
  const healthAfterReject = await fetchText(BASE, "/healthz");
  check("العدّادُ يُسجّل الرفض", /rejections=[1-9]/.test(healthAfterReject.body), healthAfterReject.body);

  // ————— [11] إعادةُ الاتصالِ سلوكُ المكتبةِ لا سلوكُنا

  console.log("\n[11] إعادةُ الاتصالِ التلقائيةُ من المكتبة");
  const attempts = [];
  const reconnects = [];
  const cRe = makeClient(BASE, {
    reconnection: true,
    reconnectionDelay: 200,
    reconnectionDelayMax: 400,
    randomizationFactor: 0,
  });
  cRe.socket.io.on("reconnect_attempt", (n) => {
    cRe.socket.auth = { ...(cRe.socket.auth || {}), lastSeq: cRe.hb.length ? cRe.hb[cRe.hb.length - 1].seq : 0 };
    attempts.push(n);
  });
  cRe.socket.io.on("reconnect", (n) => reconnects.push(n));
  await cRe.waitConnected();
  await cRe.waitBeats(3, 4000);
  const seqBeforeCut = cRe.hb[cRe.hb.length - 1].seq;
  cRe.socket.io.engine.close();
  await waitUntil(() => reconnects.length > 0, 8000, "reconnect");
  check("محاولةُ إعادةٍ مرقَّمةٌ سُجِّلت", attempts.length >= 1 && attempts[0] === 1, attempts);
  check("إعادةُ الاتصالِ نجحت", reconnects.length >= 1, reconnects);
  check("عددُ محاولاتِ الإعادةِ يُقرأ من المكتبة", typeof attempts[0] === "number", attempts);
  await waitUntil(() => cRe.connected && cRe.connected.resumedFrom > 0, 4000, "resumed");
  check(
    "الاستئنافُ بعد الإعادةِ من آخرِ تسلسلٍ معروف",
    cRe.connected.resumedFrom === seqBeforeCut,
    { resumedFrom: cRe.connected.resumedFrom, seqBeforeCut },
  );
  check("زمنُ الاتصالِ الجديدِ مقيس", typeof cRe.connectMs === "number" && cRe.connectMs >= 0, cRe.connectMs);
  cRe.close();
  await sleep(300);

  // ————— [12] العدّ لا يتضاعف

  console.log("\n[12] العدّ لا يتضاعف");
  c1.close();
  await sleep(600);
  const finalHealth = await fetchText(BASE, "/healthz");
  check("openSockets = 0 لا سالباً", finalHealth.body.includes("openSockets=0"), finalHealth.body);
  const openedIds = serverOut.match(/\[io\] open socket=(\d+)/g) || [];
  const closedIds = serverOut.match(/\[io\] closed socket=(\d+)/g) || [];
  check(
    "سطرُ إغلاقٍ واحدٌ لكلِّ جلسة",
    openedIds.length === closedIds.length && openedIds.length >= 10,
    { opened: openedIds.length, closed: closedIds.length },
  );
  const closedNumbers = closedIds.map((l) => l.match(/socket=(\d+)/)[1]);
  check("لا رقمَ جلسةٍ يُغلَق مرّتَين", new Set(closedNumbers).size === closedNumbers.length, closedNumbers);
  check("كلُّ الجلساتِ بنفسِ bootId", (serverOut.match(/bootId=/g) || []).length >= 1, false);
  check(
    "لا سطرَ إغلاقٍ بلا سببٍ مكتوب",
    (serverOut.match(/\[io\] closed socket=\d+ id=\S+ why=""/g) || []).length === 0,
    false,
  );
} finally {
  child.kill("SIGTERM");
  childNoUpgrade.kill("SIGTERM");
  await sleep(400);
  if (!child.killed) child.kill("SIGKILL");
  if (!childNoUpgrade.killed) childNoUpgrade.kill("SIGKILL");
}

console.log(`\n— الحصيلة: ${passed} ناجح، ${failures.length} فاشل —`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("كل فحوص المسبار الذاتية نجحت على Node في بيئة التطوير.");
console.log("وهذا لا يقول شيئاً عن iOS أو Android أو حاوية تلغرام.");
process.exit(0);
