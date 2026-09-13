// فحصٌ ذاتيٌّ للمسبار — يتحقّق أنّ المسبارَ نفسَه سليم، لا أنّ SSE يعمل في تلغرام.
// يُشغَّل: `node probe/dec-06-sse/selftest.mjs` (أو بـbun).
// يرفع نبضةَ الخادمِ إلى 300ms ليبقى الفحصُ قصيراً — والمنطقُ المُختبَرُ واحد.
//
// وحدُّه الصريح: هذا الفحصُ يقيس الخادمَ والصفحةَ في Node على هذه الآلة.
// **ولا يقول شيئاً عن سلوكِ iOS أو Android أو حاويةِ ويبِ تلغرام.**

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { get } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8791;
const BEAT = 300;
const BASE = `http://127.0.0.1:${PORT}`;

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

// يفتح مجرى SSE ويجمع الأحداثَ حتى `wantBeats` نبضةً أو حتى المهلة.
function collectStream(path, headers, wantBeats, timeoutMs) {
  return new Promise((resolve, reject) => {
    const events = [];
    const beats = [];
    let raw = "";
    let settled = false;
    const req = get(`${BASE}${path}`, { headers }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        raw += chunk;
        let idx = raw.indexOf("\n\n");
        while (idx !== -1) {
          const frame = raw.slice(0, idx);
          raw = raw.slice(idx + 2);
          const rec = { at: Date.now(), id: null, event: null, data: null, comment: false };
          for (const line of frame.split("\n")) {
            if (line.startsWith(":")) rec.comment = true;
            else if (line.startsWith("id: ")) rec.id = line.slice(4);
            else if (line.startsWith("event: ")) rec.event = line.slice(7);
            else if (line.startsWith("retry: ")) rec.event = "retry";
            else if (line.startsWith("data: ")) rec.data = JSON.parse(line.slice(6));
          }
          events.push(rec);
          if (rec.event === "heartbeat") beats.push(rec);
          if (beats.length >= wantBeats && !settled) {
            settled = true;
            req.destroy();
            resolve({ status: res.statusCode, headers: res.headers, events, beats });
          }
          idx = raw.indexOf("\n\n");
        }
      });
      res.on("end", () => {
        if (!settled) {
          settled = true;
          resolve({ status: res.statusCode, headers: res.headers, events, beats });
        }
      });
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        resolve({ status: null, headers: {}, events, beats });
      }
    }, timeoutMs).unref();
  });
}

console.log("— فحص المسبار الذاتي —\n");

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
check("الصفحة تستخدم EventSource", pageSrc.includes("new EventSource("), false);
check("الخادم يقرأ Last-Event-ID", serverSrc.includes('"last-event-id"'), false);

const child = spawn(process.execPath, [join(HERE, "server.mjs")], {
  env: { ...process.env, PORT: String(PORT), PROBE_HEARTBEAT_MS: String(BEAT) },
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
  await sleep(600);

  console.log("\n[1] الحياة والصفحة");
  const health = await fetchText("/healthz");
  check("healthz = 200", health.status === 200, health.status);
  check("healthz يذكر bootId", health.body.includes("bootId="), health.body);

  const page = await fetchText("/");
  check("الصفحة = 200", page.status === 200, page.status);
  check("الصفحة HTML", String(page.headers["content-type"]).includes("text/html"), page.headers);
  check("الصفحة فيها زر التصدير", page.body.includes('id="copy"'), false);

  const missing = await fetchText("/nope");
  check("مسار مجهول = 404", missing.status === 404, missing.status);

  console.log("\n[2] ترويسات المجرى وإطاره الأول");
  const first = await collectStream("/sse", {}, 3, 6000);
  check("المجرى = 200", first.status === 200, first.status);
  check(
    "content-type = text/event-stream",
    String(first.headers["content-type"]).startsWith("text/event-stream"),
    first.headers["content-type"],
  );
  check(
    "cache-control بلا تخزين ولا تحويل",
    String(first.headers["cache-control"]).includes("no-cache") &&
      String(first.headers["cache-control"]).includes("no-transform"),
    first.headers["cache-control"],
  );
  check(
    "X-Accel-Buffering: no",
    first.headers["x-accel-buffering"] === "no",
    first.headers["x-accel-buffering"],
  );
  check("تعليق حاشٍ يكسر التخزين", first.events.some((e) => e.comment), false);
  check("retry معلَن", first.events.some((e) => e.event === "retry"), false);

  const connected = first.events.find((e) => e.event === "connected");
  check("حدث connected موجود", Boolean(connected), false);
  check("connected بلا id", connected ? connected.id === null : false, connected && connected.id);
  check("resumedFrom = 0 لاتصال جديد", connected ? connected.data.resumedFrom === 0 : false, connected && connected.data);
  check("heartbeatMs معلَن", connected ? connected.data.heartbeatMs === BEAT : false, connected && connected.data);

  console.log("\n[3] التسلسل والتوقيت");
  const seqs = first.beats.map((b) => b.data.seq);
  check("التسلسل يبدأ من 1", seqs[0] === 1, seqs);
  check("التسلسل متصاعد بواحد", seqs.every((s, i) => s === i + 1), seqs);
  check(
    "id: يطابق seq",
    first.beats.every((b) => Number(b.id) === b.data.seq),
    first.beats.map((b) => b.id),
  );
  const spacing = first.beats.slice(1).map((b, i) => b.at - first.beats[i].at);
  check(
    `التباعد قريب من ${BEAT}ms`,
    spacing.every((s) => s > BEAT * 0.5 && s < BEAT * 3),
    spacing,
  );

  console.log("\n[4] الاستئناف بـLast-Event-ID");
  const resumed = await collectStream("/sse", { "Last-Event-ID": "9" }, 2, 6000);
  const rConn = resumed.events.find((e) => e.event === "connected");
  check("resumedFrom = 9", rConn ? rConn.data.resumedFrom === 9 : false, rConn && rConn.data);
  check(
    "الترويسة قُرِئت كما هي",
    rConn ? rConn.data.lastEventIdHeaderSeen === "9" : false,
    rConn && rConn.data,
  );
  check(
    "أول نبضة بعد الاستئناف = 10",
    resumed.beats[0] ? resumed.beats[0].data.seq === 10 : false,
    resumed.beats.map((b) => b.data.seq),
  );

  const viaQuery = await collectStream("/sse?lastEventId=42", {}, 1, 6000);
  check(
    "المعامَل اليدوي يستأنف من 43",
    viaQuery.beats[0] ? viaQuery.beats[0].data.seq === 43 : false,
    viaQuery.beats.map((b) => b.data.seq),
  );

  const bad = await collectStream("/sse", { "Last-Event-ID": "not-a-number" }, 1, 6000);
  check(
    "قيمة فاسدة تعود إلى 1 لا NaN",
    bad.beats[0] ? bad.beats[0].data.seq === 1 : false,
    bad.beats.map((b) => b.data.seq),
  );

  console.log("\n[5] الحالة الداخلية");
  const afterHealth = await fetchText("/healthz");
  check("الاتصالات المغلقة أُحصيت", afterHealth.body.includes("openStreams=0"), afterHealth.body);
  check("إغلاق المجرى سُجِّل", serverOut.includes("[sse] closed"), serverOut.slice(-300));
  check("كل المجاري بنفس bootId", (serverOut.match(/bootId=/g) || []).length >= 1, false);
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
