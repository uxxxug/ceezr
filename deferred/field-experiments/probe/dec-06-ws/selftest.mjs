// فحصٌ ذاتيٌّ لمسبارِ WebSocket — يتحقّق أنّ المسبارَ نفسَه سليم، لا أنّ WebSocket
// يعمل في تلغرام. يُشغَّل: `node probe/dec-06-ws/selftest.mjs` (أو بـbun).
// يرفع نبضةَ الخادمِ إلى 300ms و`ping` إلى 400ms ليبقى الفحصُ قصيراً — والمنطقُ
// المُختبَرُ واحدٌ في الحالتَين.
//
// وعميلُ WebSocket هنا مكتوبٌ بيدٍ فوق `node:http` و`node:crypto` لسببَين:
// أوّلُهما أنّ المسبارَ **بصفرِ اعتماديات**، وثانيهما أنّ `WebSocket` العالميَّ
// غيرُ موجودٍ في Node 20 وغيرُ مضمونٍ في كلِّ بيئةٍ — فالعميلُ اليدويُّ يعمل على
// Node وعلى Bun بلا فرق.
//
// وحدُّه الصريح: هذا الفحصُ يقيس الخادمَ والصفحةَ في Node على هذه الآلة.
// **ولا يقول شيئاً عن سلوكِ iOS أو Android أو حاويةِ ويبِ تلغرام.**

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { get, request } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8792;
const BEAT = 300;
const PING = 400;
const BASE = `http://127.0.0.1:${PORT}`;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

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

function fetchText(path) {
  return new Promise((resolve, reject) => {
    get(`${BASE}${path}`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

// ————— عميلُ WebSocket يدويٌّ: مصافحةٌ ثمّ تأطيرُ RFC 6455 بقناعٍ إلزاميٍّ من العميل

function encodeClientFrame(opcode, payload, { fin = true, mask = true } = {}) {
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
  header[0] = (fin ? 0x80 : 0x00) | opcode;
  if (!mask) return Buffer.concat([header, body]);
  header[1] |= 0x80;
  const maskKey = randomBytes(4);
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 1) masked[i] = body[i] ^ maskKey[i & 3];
  return Buffer.concat([header, maskKey, masked]);
}

// إطاراتُ الخادمِ غيرُ مقنَّعة. ويُفكُّ ما تمَّ منها فقط.
function decodeServerFrames(buffer) {
  const frames = [];
  let offset = 0;
  for (;;) {
    if (buffer.length - offset < 2) break;
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    let len = b1 & 0x7f;
    let cursor = offset + 2;
    if (len === 126) {
      if (buffer.length - cursor < 2) break;
      len = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (len === 127) {
      if (buffer.length - cursor < 8) break;
      len = buffer.readUInt32BE(cursor + 4);
      cursor += 8;
    }
    if (buffer.length - cursor < len) break;
    frames.push({ fin, opcode, payload: buffer.subarray(cursor, cursor + len) });
    offset = cursor + len;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function openClient(path, { autoPong = true, extraHeaders = {}, version = "13" } = {}) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString("base64");
    const expectedAccept = createHash("sha1").update(key + GUID).digest("base64");
    const headers = {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Key": key,
      ...extraHeaders,
    };
    if (version !== null) headers["Sec-WebSocket-Version"] = version;
    const req = request({ host: "127.0.0.1", port: PORT, path, headers });

    req.on("response", (res) => {
      res.resume();
      resolve({ upgraded: false, status: res.statusCode, expectedAccept });
    });

    req.on("upgrade", (res, socket, head) => {
      let buffer = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
      const messages = [];
      const pings = [];
      const pongs = [];
      const closeFrames = [];
      let socketClosed = false;

      const client = {
        upgraded: true,
        status: res.statusCode,
        headers: res.headers,
        expectedAccept,
        messages,
        pings,
        pongs,
        closeFrames,
        get socketClosed() {
          return socketClosed;
        },
        send(obj) {
          socket.write(encodeClientFrame(0x1, Buffer.from(JSON.stringify(obj), "utf8")));
        },
        sendRaw(buf) {
          socket.write(buf);
        },
        ping(payload) {
          socket.write(encodeClientFrame(0x9, Buffer.from(payload, "utf8")));
        },
        close(code, reason) {
          const reasonBuf = Buffer.from(reason ?? "", "utf8");
          const body = Buffer.alloc(2 + reasonBuf.length);
          body.writeUInt16BE(code, 0);
          reasonBuf.copy(body, 2);
          socket.write(encodeClientFrame(0x8, body));
        },
        destroy() {
          socket.destroy();
        },
        beats() {
          return messages.filter((m) => m.data.type === "heartbeat");
        },
        first(type) {
          return messages.find((m) => m.data.type === type);
        },
        last(type) {
          return messages.filter((m) => m.data.type === type).slice(-1)[0];
        },
        waitFor(predicate, timeoutMs) {
          return new Promise((res2) => {
            const started = Date.now();
            const timer = setInterval(() => {
              if (predicate(client)) {
                clearInterval(timer);
                res2(true);
              } else if (Date.now() - started > timeoutMs) {
                clearInterval(timer);
                res2(false);
              }
            }, 20);
          });
        },
      };

      socket.on("data", (chunk) => {
        buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
        const decoded = decodeServerFrames(buffer);
        buffer = decoded.rest;
        for (const frame of decoded.frames) {
          if (frame.opcode === 0x1) {
            try {
              messages.push({ at: Date.now(), data: JSON.parse(frame.payload.toString("utf8")) });
            } catch {
              messages.push({ at: Date.now(), data: { type: "unparsable" } });
            }
          } else if (frame.opcode === 0x9) {
            pings.push({ at: Date.now(), payload: frame.payload.toString("utf8") });
            if (autoPong) socket.write(encodeClientFrame(0xa, frame.payload));
          } else if (frame.opcode === 0xa) {
            pongs.push({ at: Date.now(), payload: frame.payload.toString("utf8") });
          } else if (frame.opcode === 0x8) {
            closeFrames.push({
              at: Date.now(),
              code: frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : null,
              reason: frame.payload.length > 2 ? frame.payload.subarray(2).toString("utf8") : "",
            });
          }
        }
      });
      socket.on("close", () => {
        socketClosed = true;
      });
      socket.on("error", () => {
        socketClosed = true;
      });

      resolve(client);
    });

    req.on("error", reject);
    req.end();
  });
}

console.log("— فحص مسبار WebSocket الذاتي —\n");

// (0) عزلُ المسبار: تحقُّقٌ نصّيٌّ قبل أيِّ تشغيل.
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
const both = `${strip(serverSrc)}\n${strip(pageSrc)}`;
for (const forbidden of ["postgres", "pg_notify", "redis", "upstash", "supabase", "grammy"]) {
  check(
    `لا استعمال لـ${forbidden} في الشيفرة`,
    !both.toLowerCase().includes(forbidden),
    forbidden,
  );
}
check(
  "لا استيراد من apps/ أو packages/",
  !/from\s+["'][^"']*(apps|packages)\//.test(serverSrc),
  "import",
);
check("لا اعتمادية خارجية في الخادم", !/from\s+["'](?!node:)/.test(serverSrc), "import");
check("الصفحة تستخدم WebSocket", pageSrc.includes("new WebSocket("), false);
check("الخادم ينفّذ مصافحة RFC 6455", serverSrc.includes(GUID), false);
check("الخادم يقرأ sec-websocket-key", serverSrc.includes('"sec-websocket-key"'), false);
// شرطٌ صريح: لا تُكتَب قيمةُ `initData` الخامُ في السجلِّ ولا في المخرَج.
check(
  "لا كتابة لقيمة initData الخام في الصفحة",
  !/initData\s*:/.test(strip(pageSrc)) && strip(pageSrc).includes("initDataPresent: Boolean("),
  "initData",
);
check("الصفحة فيها زر التصدير", pageSrc.includes('id="copy"'), false);
check("الصفحة تُجدوِل إعادة الاتصال بنفسها", pageSrc.includes("scheduleReconnect"), false);

const child = spawn(process.execPath, [join(HERE, "server.mjs")], {
  env: {
    ...process.env,
    PORT: String(PORT),
    PROBE_HEARTBEAT_MS: String(BEAT),
    PROBE_PING_MS: String(PING),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
let serverOut = "";
child.stdout.on("data", (d) => {
  serverOut += d;
});
child.stderr.on("data", (d) => {
  serverOut += d;
});

try {
  await sleep(700);

  console.log("\n[1] الحياة والصفحة");
  const health = await fetchText("/healthz");
  check("healthz = 200", health.status === 200, health.status);
  check("healthz يذكر bootId", health.body.includes("bootId="), health.body);
  check("healthz يذكر openSockets", health.body.includes("openSockets="), health.body);

  const page = await fetchText("/");
  check("الصفحة = 200", page.status === 200, page.status);
  check("الصفحة HTML", String(page.headers["content-type"]).includes("text/html"), page.headers);

  const missing = await fetchText("/nope");
  check("مسار مجهول = 404", missing.status === 404, missing.status);

  console.log("\n[2] المصافحة");
  const c1 = await openClient("/ws");
  check("الترقية = 101", c1.upgraded && c1.status === 101, c1.status);
  check(
    "Sec-WebSocket-Accept محسوبٌ صحيحاً",
    c1.upgraded && c1.headers["sec-websocket-accept"] === c1.expectedAccept,
    c1.upgraded && c1.headers["sec-websocket-accept"],
  );
  check(
    "ترويسة upgrade = websocket",
    c1.upgraded && String(c1.headers.upgrade).toLowerCase() === "websocket",
    c1.upgraded && c1.headers.upgrade,
  );

  const noKey = await openClient("/ws", { extraHeaders: { "Sec-WebSocket-Key": "" } });
  check("ترقيةٌ بلا مفتاح = 400", noKey.upgraded === false && noKey.status === 400, noKey.status);

  const badVersion = await openClient("/ws", { version: "8" });
  check(
    "إصدارٌ غيرُ 13 = 426",
    badVersion.upgraded === false && badVersion.status === 426,
    badVersion.status,
  );

  const wrongPath = await openClient("/nope");
  check(
    "ترقيةٌ على مسارٍ آخر = 404",
    wrongPath.upgraded === false && wrongPath.status === 404,
    wrongPath.status,
  );

  console.log("\n[3] رسالة الوصل");
  await c1.waitFor((c) => Boolean(c.first("connected")), 3000);
  const connected = c1.first("connected");
  check("رسالة connected موجودة", Boolean(connected), false);
  check(
    "connected بلا seq",
    connected ? connected.data.seq === undefined : false,
    connected && connected.data,
  );
  check(
    "resumedFrom = 0 لاتصالٍ جديد",
    connected ? connected.data.resumedFrom === 0 : false,
    connected && connected.data,
  );
  check(
    "heartbeatMs معلَن",
    connected ? connected.data.heartbeatMs === BEAT : false,
    connected && connected.data,
  );
  check(
    "الاستئنافُ معلَنٌ أنّه بمبادرةِ العميل",
    connected ? connected.data.resumeIsClientDriven === true : false,
    connected && connected.data,
  );

  console.log("\n[4] التسلسل والتوقيت");
  await c1.waitFor((c) => c.beats().length >= 4, 5000);
  const beats = c1.beats();
  const seqs = beats.map((b) => b.data.seq);
  check("التسلسل يبدأ من 1", seqs[0] === 1, seqs);
  check(
    "التسلسل متصاعد بواحد",
    seqs.every((s, i) => s === i + 1),
    seqs,
  );
  const spacing = beats.slice(1).map((b, i) => b.at - beats[i].at);
  check(
    `التباعد قريب من ${BEAT}ms`,
    spacing.every((s) => s > BEAT * 0.5 && s < BEAT * 3),
    spacing,
  );

  console.log("\n[5] الاتجاه المعاكس — إقرارٌ من العميل");
  c1.send({ type: "ack", seq: seqs[seqs.length - 1] });
  const ackSeen = await c1.waitFor(
    (c) => c.beats().some((b) => b.data.lastAckSeq === seqs[seqs.length - 1]),
    3000,
  );
  check("الخادم أعلنَ lastAckSeq", ackSeen, c1.beats().slice(-1)[0]);
  check(
    "acksReceived تزايد",
    c1.beats().slice(-1)[0].data.acksReceived >= 1,
    c1.beats().slice(-1)[0].data,
  );

  c1.send({ type: "echo", nonce: "n-1" });
  await c1.waitFor((c) => Boolean(c.first("echo-reply")), 3000);
  const echo = c1.first("echo-reply");
  check("echo-reply بنفس المُعرِّف", echo ? echo.data.nonce === "n-1" : false, echo && echo.data);

  console.log("\n[6] ping و pong في الاتجاهين");
  c1.ping("hello-ping");
  await c1.waitFor((c) => c.pongs.length >= 1, 3000);
  check("pong من الخادم بنفس الحمولة", c1.pongs.some((p) => p.payload === "hello-ping"), c1.pongs);
  check("الخادم بعثَ ping من تلقائه", c1.pings.length >= 1, c1.pings.length);
  const pongCounted = await c1.waitFor(
    (c) => c.beats().some((b) => b.data.pongsReceived >= 1),
    3000,
  );
  check("الخادم أحصى pong العميل", pongCounted, c1.beats().slice(-1)[0].data);

  console.log("\n[7] الإغلاق برمزٍ وسببٍ من العميل");
  c1.close(1000, "selftest-bye");
  await c1.waitFor((c) => c.closeFrames.length >= 1 || c.socketClosed, 3000);
  check(
    "الخادم سجّل رمزَ إغلاقِ العميل",
    serverOut.includes("[ws] client-close") && serverOut.includes("code=1000"),
    serverOut.slice(-400),
  );
  check("الخادم سجّل سببَ الإغلاق", serverOut.includes("selftest-bye"), serverOut.slice(-400));
  await sleep(300);
  const afterClose = await fetchText("/healthz");
  check("openSockets عاد إلى 0", afterClose.body.includes("openSockets=0"), afterClose.body);

  console.log("\n[8] الاستئناف بتمريرِ نقطةٍ من العميل");
  const c2 = await openClient("/ws?lastSeq=9");
  await c2.waitFor((c) => c.beats().length >= 1, 4000);
  const c2conn = c2.first("connected");
  check("resumedFrom = 9", c2conn ? c2conn.data.resumedFrom === 9 : false, c2conn && c2conn.data);
  check(
    "أول نبضة بعد الاستئناف = 10",
    c2.beats()[0] ? c2.beats()[0].data.seq === 10 : false,
    c2.beats().map((b) => b.data.seq),
  );
  c2.destroy();

  const c3 = await openClient("/ws?lastSeq=not-a-number");
  await c3.waitFor((c) => c.beats().length >= 1, 4000);
  check(
    "قيمة فاسدة تعود إلى 1 لا NaN",
    c3.beats()[0] ? c3.beats()[0].data.seq === 1 : false,
    c3.beats().map((b) => b.data.seq),
  );
  c3.destroy();

  console.log("\n[9] إغلاقٌ يبدؤه الخادم برمزٍ وسبب");
  const c4 = await openClient("/ws?closeAfterMs=250&closeCode=4001&closeReason=probe-forced");
  await c4.waitFor((c) => c.closeFrames.length >= 1, 4000);
  check("وصل إطارُ إغلاقٍ من الخادم", c4.closeFrames.length >= 1, c4.closeFrames);
  check(
    "رمزُ الإغلاق = 4001",
    c4.closeFrames[0] ? c4.closeFrames[0].code === 4001 : false,
    c4.closeFrames[0],
  );
  check(
    "سببُ الإغلاق كما طُلب",
    c4.closeFrames[0] ? c4.closeFrames[0].reason === "probe-forced" : false,
    c4.closeFrames[0],
  );

  console.log("\n[10] أخطاء البروتوكول تُغلَق برمزٍ صحيح");
  const c5 = await openClient("/ws");
  await c5.waitFor((c) => Boolean(c.first("connected")), 3000);
  c5.sendRaw(encodeClientFrame(0x1, Buffer.from('{"type":"ack","seq":1}', "utf8"), { mask: false }));
  await c5.waitFor((c) => c.closeFrames.length >= 1, 3000);
  check(
    "إطارٌ بلا قناع يُغلَق بـ1002",
    c5.closeFrames[0] ? c5.closeFrames[0].code === 1002 : false,
    c5.closeFrames[0],
  );
  check(
    "سببُ الإغلاق يشرح الخطأ",
    c5.closeFrames[0] ? c5.closeFrames[0].reason === "unmasked-client-frame" : false,
    c5.closeFrames[0],
  );

  const c6 = await openClient("/ws");
  await c6.waitFor((c) => Boolean(c.first("connected")), 3000);
  c6.sendRaw(encodeClientFrame(0x1, Buffer.alloc(70000, 0x61)));
  await c6.waitFor((c) => c.closeFrames.length >= 1, 3000);
  check(
    "حمولةٌ فوق الحدّ تُغلَق بـ1009",
    c6.closeFrames[0] ? c6.closeFrames[0].code === 1009 : false,
    c6.closeFrames[0],
  );

  console.log("\n[11] رسالةٌ مجزّأةٌ على إطارَين");
  const c7 = await openClient("/ws");
  await c7.waitFor((c) => Boolean(c.first("connected")), 3000);
  const whole = '{"type":"echo","nonce":"frag"}';
  c7.sendRaw(encodeClientFrame(0x1, Buffer.from(whole.slice(0, 12), "utf8"), { fin: false }));
  c7.sendRaw(encodeClientFrame(0x0, Buffer.from(whole.slice(12), "utf8"), { fin: true }));
  await c7.waitFor((c) => Boolean(c.first("echo-reply")), 3000);
  const fragEcho = c7.first("echo-reply");
  check(
    "الرسالةُ المجزّأةُ جُمِعت وفُهِمت",
    fragEcho ? fragEcho.data.nonce === "frag" : false,
    fragEcho && fragEcho.data,
  );
  c7.destroy();
  await sleep(250);

  console.log("\n[12] العدّ لا يتضاعف عند اجتماعِ الخطأِ والإغلاق");
  const c8 = await openClient("/ws");
  await c8.waitFor((c) => Boolean(c.first("connected")), 3000);
  c8.destroy(); // هدمٌ فجائيّ: يُوقِع `error` و`close` معاً على الخادم
  await sleep(500);
  const finalHealth = await fetchText("/healthz");
  check("openSockets = 0 لا سالباً", finalHealth.body.includes("openSockets=0"), finalHealth.body);
  const opened = (serverOut.match(/\[ws\] open socket=/g) || []).length;
  const closedLines = (serverOut.match(/\[ws\] closed socket=/g) || []).length;
  check("سطرُ إغلاقٍ واحدٌ لكلِّ مقبس", opened === closedLines && opened >= 8, {
    opened,
    closedLines,
  });
  check("كل المقابس بنفس bootId", (serverOut.match(/bootId=/g) || []).length >= 1, false);
} finally {
  child.kill("SIGTERM");
  await sleep(300);
  if (!child.killed) child.kill("SIGKILL");
}

console.log(`\n— الحصيلة: ${passed} ناجح، ${failures.length} فاشل —`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("كل فحوص المسبار الذاتية نجحت على Node في بيئة التطوير.");
console.log("وهذا لا يقول شيئاً عن iOS أو Android أو حاوية تلغرام.");
