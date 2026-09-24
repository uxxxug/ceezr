/**
 * الغرض: قياسُ أوّلِ رسمٍ بمتصفّحٍ حقيقيٍّ بلا رأسٍ على **مُخرَجِ البناءِ نفسِه**
 *   (`apps/miniapp/dist`) مُقدَّماً كما يُقدِّمُه Render (ضغطُ `gzip` · إعادةُ كتابةِ كلِّ
 *   مسارٍ مجهولٍ إلى `index.html` · `X-Content-Type-Options: nosniff`)، ثمَّ الحكمُ
 *   بـ`scripts/lib/first-paint-budget.ts`. ويُسقِطُ البناءَ على شاشةٍ بيضاءَ (`D-25`)
 *   وعلى خرقٍ غيرِ مُعلَنٍ أو مُنحدِرٍ أو إعلانٍ ميّتٍ لصفَّي `FCP`/`LCP` (`F1-09`).
 * الحالة: منفّذ فعلياً — أداةُ قياسٍ لا منطقُ أعمالٍ.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: وظيفةُ «متصفّحٌ حقيقيٌّ — أوّلُ رسمٍ» في `.github/workflows/ci.yml`.
 *
 * **بلا تبعيّةٍ جديدةٍ**: بروتوكولُ أدواتِ المطوِّرِ (`CDP`) عبرَ `WebSocket` المدمجِ في
 * Bun، والمتصفّحُ من المُنفِّذِ (`google-chrome` مُثبَّتٌ في صورةِ `ubuntu-latest`) أو
 * من `CHROME_PATH`. وغيابُ المتصفّحِ **إخفاقٌ لا تخطٍّ**.
 *
 * **حدودُ القياسِ مُعلَنةٌ لا مسكوتٌ عنها** (`ح-5` · `ADR 0183`):
 *   - سكربتُ `telegram.org` **محجوبٌ** عمداً ليكونَ القياسُ محكوماً لا رهينةَ شبكةٍ
 *     خارجيّةٍ — وهوَ سكربتٌ متزامنٌ في `<head>` فالأرقامُ **حدٌّ أدنى** لا أعلى.
 *   - الشاشةُ المقيسةُ هيَ ما يرسمُه التطبيقُ **خارجَ تيليجرام** (لا `initData`) —
 *     فالصفُّ 5 («وقتُ التفاعلِ بعدَ فتحِ تيليجرام») **غيرُ مقيسٍ** ولا يُدَّعى.
 *   - المُنفِّذُ ليسَ جوّالاً: المعالجُ مُبطَّأٌ ×4 افتراضاً مُعلَناً لا جهازاً مقيساً.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";
import {
  DECLARED_BREACHES,
  declaredDecisionIds,
  evaluateFirstPaint,
  FIRST_PAINT_BUDGET,
  livenessProblems,
  type NetworkProfile,
  type PaintRun,
  SLOW_3G,
} from "./lib/first-paint-budget.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const DIST = join(ROOT, "apps/miniapp/dist");
const THROTTLED_RUNS = 3;
const RUN_TIMEOUT_MS = 60_000;
const QUIET_WINDOW_MS = 2_000;

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** يُقدِّمُ `dist` كما يُقدِّمُه Render: ملفٌّ موجودٌ أو `index.html` لكلِّ ما سواه. */
function serveDist(): { port: number; stop: () => void } {
  const cache = new Map<string, Uint8Array>();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      let path = decodeURIComponent(new URL(request.url).pathname);
      if (path === "/") path = "/index.html";
      let file = normalize(join(DIST, path));
      if (!file.startsWith(DIST) || !existsSync(file) || !file.includes(".")) {
        file = join(DIST, "index.html"); // `rewrite /* → /index.html` في `render.yaml`
      }
      let body = cache.get(file);
      if (body === undefined) {
        body = gzipSync(readFileSync(file), { level: 9 });
        cache.set(file, body);
      }
      return new Response(body, {
        headers: {
          "content-type": MIME[extname(file)] ?? "application/octet-stream",
          "content-encoding": "gzip",
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
        },
      });
    },
  });
  return { port: server.port as number, stop: () => server.stop(true) };
}

function findBrowser(): string {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv !== undefined && fromEnv !== "") {
    if (!existsSync(fromEnv)) throw new Error(`CHROME_PATH لا يُشيرُ إلى ملفٍّ: ${fromEnv}`);
    return fromEnv;
  }
  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const playwright = join(process.env.HOME ?? "", ".cache/ms-playwright");
  if (existsSync(playwright)) {
    for (const dir of readdirSync(playwright).filter((d) => d.startsWith("chromium"))) {
      for (const sub of readdirSync(join(playwright, dir))) {
        candidates.push(join(playwright, dir, sub, "chrome-headless-shell"));
        candidates.push(join(playwright, dir, sub, "chrome"));
      }
    }
  }
  const found = candidates.find((c) => existsSync(c));
  if (found === undefined) {
    throw new Error("لا متصفّحَ — عيِّنْ CHROME_PATH. وغيابُه إخفاقٌ لا تخطٍّ: قياسٌ لم يُجرَ ليسَ أخضرَ.");
  }
  return found;
}

interface CdpEvent {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

class Cdp {
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  readonly listeners: Array<(event: CdpEvent) => void> = [];

  private constructor(private readonly socket: WebSocket) {
    socket.onmessage = (message) => {
      const data = JSON.parse(String(message.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
        method?: string;
        params?: Record<string, unknown>;
      };
      if (data.id !== undefined) {
        const waiter = this.pending.get(data.id);
        if (waiter === undefined) return;
        this.pending.delete(data.id);
        if (data.error !== undefined) waiter.reject(new Error(data.error.message));
        else waiter.resolve(data.result);
      } else if (data.method !== undefined) {
        for (const listener of this.listeners)
          listener({ method: data.method, params: data.params ?? {} });
      }
    };
  }

  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error(`تعذَّرَ الاتّصالُ بـ${url}`));
    });
    return new Cdp(socket);
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

const OBSERVERS = `
window.__paint = { fcp: null, lcp: null };
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if (e.name === "first-contentful-paint") window.__paint.fcp = e.startTime;
}).observe({ type: "paint", buffered: true });
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) window.__paint.lcp = e.startTime;
}).observe({ type: "largest-contentful-paint", buffered: true });
`;

/** منفذٌ حرٌّ الآنَ: يُحجَزُ ثمَّ يُحرَّرُ ويُعطى للمتصفّحِ. */
function freePort(): number {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = probe.port;
  probe.stop(true);
  return port;
}

async function measureOnce(
  browserPath: string,
  origin: string,
  profile: NetworkProfile | null,
): Promise<PaintRun> {
  const userDataDir = mkdtempSync(join(tmpdir(), "waslah-paint-"));
  const headlessFlag = browserPath.includes("headless-shell") ? "--headless" : "--headless=new";
  /**
   * زيادةٌ (`ح-8`): كانَ المنفذُ `0` ويُنتظَرُ ملفُّ `DevToolsActivePort` — وعلى
   * `google-chrome` في مُنفِّذِ `ubuntu-latest` لم يظهرِ الملفُّ خلالَ 15 ثانيةً
   * (التشغيلُ `35942059474`) والخطأُ بلا سببٍ لأنَّ `stderr` كانَ مُهمَلاً. فصارَ المنفذُ
   * محجوزاً سلفاً ويُسأَلُ `/json/version` نفسُه، و`stderr` يُلتقَطُ ويُطبَعُ ذيلُه متى
   * أخفقَ الإقلاعُ — فالإخفاقُ يقولُ لماذا لا أينَ فقط.
   */
  const port = freePort();
  const proc = Bun.spawn(
    [
      browserPath,
      headlessFlag,
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  let stderrTail = "";
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
      stderrTail = (stderrTail + decoder.decode(chunk)).slice(-2000);
    }
  })();
  let cdp: Cdp | null = null;
  try {
    const started = Date.now();
    let page: { type: string; webSocketDebuggerUrl: string } | undefined;
    while (page === undefined) {
      if (Date.now() - started > 30_000 || proc.exitCode !== null) {
        throw new Error(
          `لم يُقلِعِ المتصفّحُ (منفذُ ${port} · خروجٌ ${proc.exitCode ?? "—"}):\n${stderrTail || "(لا مخرجاتِ أخطاءٍ)"}`,
        );
      }
      await Bun.sleep(200);
      try {
        const targets = (await (
          await fetch(`http://127.0.0.1:${port}/json/list`)
        ).json()) as Array<{
          type: string;
          webSocketDebuggerUrl: string;
        }>;
        page = targets.find((t) => t.type === "page");
      } catch {
        // لم يُصغِ بعدُ — يُعادُ السؤالُ حتّى المهلةِ.
      }
    }
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);

    const failed: string[] = [];
    const nonScriptModules: string[] = [];
    const exceptions: string[] = [];
    const urls = new Map<string, string>();
    const inflight = new Set<string>();
    let lastNetworkActivity = Date.now();
    cdp.listeners.push(({ method, params }) => {
      const requestId = String(params.requestId ?? "");
      if (method === "Network.requestWillBeSent") {
        const request = params.request as { url: string };
        urls.set(requestId, request.url);
        inflight.add(requestId);
        lastNetworkActivity = Date.now();
      } else if (method === "Network.responseReceived") {
        const response = params.response as { url: string; status: number; mimeType: string };
        if (response.url.startsWith(origin)) {
          if (response.status >= 400) failed.push(`${response.status} ${response.url}`);
          if (params.type === "Script" && !response.mimeType.includes("javascript")) {
            nonScriptModules.push(`${response.mimeType} ${response.url}`);
          }
        }
      } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
        inflight.delete(requestId);
        lastNetworkActivity = Date.now();
        const url = urls.get(requestId) ?? "";
        if (method === "Network.loadingFailed" && url.startsWith(origin)) {
          failed.push(`${String(params.errorText)} ${url}`);
        }
      } else if (method === "Runtime.exceptionThrown") {
        const details = params.exceptionDetails as {
          text?: string;
          exception?: { description?: string };
        };
        exceptions.push(details.exception?.description ?? details.text ?? "استثناءٌ بلا نصٍّ");
      }
    });

    await cdp.send("Network.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.setBlockedURLs", {
      urls: ["*://telegram.org/*", "*://*.telegram.org/*"],
    });
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 412,
      height: 823,
      deviceScaleFactor: 2.625,
      mobile: true,
    });
    if (profile !== null) {
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: profile.latencyMs,
        downloadThroughput: profile.downloadBytesPerSecond,
        uploadThroughput: profile.uploadBytesPerSecond,
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuSlowdown });
    }
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVERS });
    await cdp.send("Page.navigate", { url: `${origin}/` });

    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let state = {
      fcp: null as number | null,
      lcp: null as number | null,
      root: 0,
      complete: false,
    };
    while (Date.now() < deadline) {
      await Bun.sleep(250);
      const evaluated = await cdp.send<{ result: { value?: string } }>("Runtime.evaluate", {
        expression:
          "JSON.stringify({fcp: window.__paint?.fcp ?? null, lcp: window.__paint?.lcp ?? null," +
          " root: document.getElementById('root')?.childElementCount ?? 0, complete: document.readyState === 'complete'})",
        returnByValue: true,
      });
      if (evaluated.result.value !== undefined) state = JSON.parse(evaluated.result.value);
      const quiet = inflight.size === 0 && Date.now() - lastNetworkActivity >= QUIET_WINDOW_MS;
      if (state.complete && quiet && state.fcp !== null) break;
    }
    return {
      fcpMs: state.fcp,
      lcpMs: state.lcp,
      rootChildCount: state.root,
      failedSameOriginRequests: failed,
      nonScriptModuleResponses: nonScriptModules,
      uncaughtExceptions: exceptions,
    };
  } finally {
    cdp?.close();
    proc.kill();
    await proc.exited;
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("✗ لا مُخرَجَ بناءٍ في apps/miniapp/dist — شغّل: bun run build:miniapp");
    process.exit(1);
  }
  const browser = findBrowser();
  const server = serveDist();
  const origin = `http://127.0.0.1:${server.port}`;
  try {
    console.log(`أوّلُ رسمٍ بمتصفّحٍ حقيقيٍّ (F1-09 · D-25) — ${browser}`);
    const unthrottled = await measureOnce(browser, origin, null);
    console.log(
      `  بلا تقييدٍ: FCP=${unthrottled.fcpMs?.toFixed(0) ?? "—"} ms · عُقَدُ #root=${unthrottled.rootChildCount}`,
    );
    /**
     * شاشةٌ بيضاءُ بلا تقييدٍ تُسقِطُ البناءَ **فوراً**: التشغيلاتُ المقيَّدةُ بعدَها
     * لا تُضيفُ حكماً وتنتظرُ كلٌّ منها مهلتَها كاملةً (60 ثانيةً) بلا رسمٍ يُنهيها.
     */
    const dead = livenessProblems(unthrottled, "بلا تقييدٍ");
    if (dead.length > 0) {
      for (const problem of dead) console.error(`✗ [${problem.rule}] ${problem.detail}`);
      process.exit(1);
    }
    const throttled: PaintRun[] = [];
    for (let i = 0; i < THROTTLED_RUNS; i++) {
      const run = await measureOnce(browser, origin, SLOW_3G);
      throttled.push(run);
      console.log(
        `  ${SLOW_3G.id} #${i + 1}: FCP=${run.fcpMs?.toFixed(0) ?? "—"} ms · LCP=${run.lcpMs?.toFixed(0) ?? "—"} ms`,
      );
    }
    const roadmap = readFileSync(join(ROOT, "docs/ROADMAP-MASTER.md"), "utf8");
    const verdict = evaluateFirstPaint({
      unthrottled,
      profile: SLOW_3G,
      throttled,
      declared: DECLARED_BREACHES,
      knownDecisions: declaredDecisionIds(roadmap),
    });
    console.log(
      `  الوسيطُ على ${SLOW_3G.id}: FCP=${verdict.medians.fcp?.toFixed(0) ?? "—"} ms (الحدُّ ${FIRST_PAINT_BUDGET.fcpMs})` +
        ` · LCP=${verdict.medians.lcp?.toFixed(0) ?? "—"} ms (الحدُّ ${FIRST_PAINT_BUDGET.lcpMs})`,
    );
    for (const breach of DECLARED_BREACHES) {
      console.log(
        `  خرقٌ مُعلَنٌ (${breach.decision}) ${breach.metric.toUpperCase()} ≤ ${breach.ceilingMs} ms: ${breach.reason}`,
      );
    }
    if (verdict.problems.length > 0) {
      for (const problem of verdict.problems)
        console.error(`✗ [${problem.rule}] ${problem.detail}`);
      process.exit(1);
    }
    console.log(
      "✓ التطبيقُ يرسمُ، والخرقانِ ضمنَ سقفَيهما المُعلَنَينِ — ولا يُقرأُ هذا استيفاءً لحدِّ 9.9 (DEC-19)",
    );
  } finally {
    server.stop();
  }
}

await main();
