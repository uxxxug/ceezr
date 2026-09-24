/**
 * F1-09 FCP Diagnostic v3 — fixed server cache, navigation timing, ablation.
 * Diagnostic only. No code changes, no gate changes.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { chromium } = require("playwright");

const DIST = path.join(__dirname, "..", "apps", "miniapp", "dist");
const CHROME_PATH = path.join(process.env.HOME || "/home/user", ".cache/ms-playwright/chromium-1217/chrome-linux64/chrome");
const MIME = { ".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".json":"application/json",".map":"application/json",".png":"image/png",".ico":"image/x-icon",".woff":"font/woff",".woff2":"font/woff2" };
const MOCK_TOKEN = "diag-token-1234567890";

// Server with NO cache — always reads from disk
function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const p = url.pathname;
      if (p === "/v1/session/telegram" && req.method === "POST") {
        const body = await new Promise(r => { let d=""; req.on("data",c=>d+=c); req.on("end",()=>r(d)); });
        const json = JSON.parse(body || "{}");
        if (json.initData) { res.writeHead(200,{"content-type":"application/json"}); res.end(JSON.stringify({accessToken:MOCK_TOKEN,tokenType:"Bearer",expiresInSeconds:600,refreshAfterSeconds:300,refreshable:true})); }
        else { res.writeHead(401,{"content-type":"application/json"}); res.end(JSON.stringify({error:"invalid_init_data"})); }
        return;
      }
      if (p === "/v1/me" && req.method === "GET") {
        if (req.headers["authorization"] === `Bearer ${MOCK_TOKEN}`) { res.writeHead(200,{"content-type":"application/json"}); res.end(JSON.stringify({role:"rider",status:"active",languageCode:"ar"})); }
        else { res.writeHead(401,{"content-type":"application/json"}); res.end(JSON.stringify({error:"unauthorized"})); }
        return;
      }
      if (p === "/v1/consents" && req.method === "GET") {
        if (req.headers["authorization"] === `Bearer ${MOCK_TOKEN}`) { res.writeHead(200,{"content-type":"application/json"}); res.end(JSON.stringify({ok:true,consents:[]})); }
        else { res.writeHead(401,{"content-type":"application/json"}); res.end(JSON.stringify({error:"unauthorized"})); }
        return;
      }
      if (p === "/health") { res.writeHead(200,{"content-type":"application/json"}); res.end(JSON.stringify({ok:true})); return; }
      let fp = decodeURIComponent(p); if (fp === "/") fp = "/index.html";
      let ap = path.normalize(path.join(DIST, fp));
      if (!ap.startsWith(DIST) || !fs.existsSync(ap) || !ap.includes(".")) ap = path.join(DIST, "index.html");
      // NO CACHE — always read from disk
      const raw = fs.readFileSync(ap);
      const body = zlib.gzipSync(raw, { level: 9 });
      res.writeHead(200, { "content-type": MIME[path.extname(ap)] || "application/octet-stream", "content-encoding": "gzip", "x-content-type-options": "nosniff", "cache-control": "no-store" });
      res.end(body);
    } catch (err) { res.writeHead(500); res.end(String(err)); }
  });
}

const TELEGRAM_MOCK = `window.Telegram={WebApp:{initData:"query_id=AAHdF6QFAAAAAAAAF6QF8ZekDgE&user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Test%22%2C%22last_name%22%3A%22User%22%2C%22username%22%3A%22testuser%22%2C%22language_code%22%3A%22ar%22%7D&auth_date=1750000000&hash=c9e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1",initDataUnsafe:{user:{id:123456789,first_name:"Test",last_name:"User",username:"testuser",language_code:"ar"},auth_date:1750000000},version:"8.0",platform:"web",colorScheme:"light",themeParams:{},isExpanded:true,viewportHeight:823,viewportStableHeight:823,ready:()=>{},expand:()=>{},close:()=>{}}};`;

const TRACE_CATEGORIES = "devtools.timeline,loading,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,disabled-by-default-devtools.timeline.stack,disabled-by-default-loading,disabled-by-default-network";

const PROFILES = [
  { latencyMs: 562.5, downloadBps: 180000, uploadBps: 84375, cpu: 4, label: "Slow_4G_CPU_4" },
  { latencyMs: 562.5, downloadBps: 180000, uploadBps: 84375, cpu: 1, label: "Slow_4G_CPU_1" },
  { latencyMs: 0, downloadBps: 0, uploadBps: 0, cpu: 1, label: "No_throttling" },
];

async function runScenario(browser, origin, profile, variant) {
  const context = await browser.newContext({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 2.625, isMobile: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  await cdp.send("Network.enable");
  await cdp.send("Network.setBlockedURLs", { urls: ["*://telegram.org/*", "*://*.telegram.org/*"] });
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: TELEGRAM_MOCK });

  if (profile.latencyMs > 0 || profile.downloadBps > 0) {
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: profile.latencyMs, downloadThroughput: profile.downloadBps, uploadThroughput: profile.uploadBps });
  }
  if (profile.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });

  // Start tracing
  await cdp.send("Tracing.start", { categories: TRACE_CATEGORIES, options: "record-mode=record-as-much-as-possible" });

  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Poll for FCP using performance API
  let fcp = null;
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 200));
    const state = await page.evaluate(() => {
      const paints = performance.getEntriesByType("paint");
      const fcpEntry = paints.find(e => e.name === "first-contentful-paint");
      return { fcp: fcpEntry ? fcpEntry.startTime : null };
    });
    if (state.fcp !== null) { fcp = state.fcp; break; }
  }

  // Wait for LCP
  await new Promise(r => setTimeout(r, 3000));

  // Get navigation timing + final state
  const finalState = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] || {};
    const paints = performance.getEntriesByType("paint");
    const fcpEntry = paints.find(e => e.name === "first-contentful-paint");
    const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
    const lcpEntry = lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1] : null;
    // Check for marker
    const html = document.documentElement.outerHTML;
    const hasMarker = html.includes("FCP_DIAG_VISIBLE_MARKER");
    return {
      fcp: fcpEntry ? fcpEntry.startTime : null,
      lcp: lcpEntry ? lcpEntry.startTime : null,
      navTiming: {
        requestStart: nav.requestStart || 0,
        responseStart: nav.responseStart || 0,
        responseEnd: nav.responseEnd || 0,
        domContentLoadedEventEnd: nav.domContentLoadedEventEnd || 0,
        loadEventEnd: nav.loadEventEnd || 0,
      },
      hasMarker,
      rootChildren: document.getElementById("root")?.childElementCount ?? 0,
    };
  });

  // Stop tracing
  const traceEvents = [];
  const tracingComplete = new Promise(resolve => {
    cdp.on("Tracing.dataCollected", data => traceEvents.push(...data.value));
    cdp.on("Tracing.tracingComplete", () => resolve());
  });
  await cdp.send("Tracing.end");
  await tracingComplete;

  await context.close().catch(() => {});

  // Verify telegram blocking
  const telegramBlocked = !traceEvents.some(e => e.name === "ResourceReceiveResponse" && e.args?.data?.url?.includes("telegram.org"));

  // Save trace
  const traceFile = path.join(__dirname, `diag-trace-${variant}-${profile.label}.json`);
  fs.writeFileSync(traceFile, JSON.stringify(traceEvents));

  return {
    label: profile.label, variant,
    fcp: finalState.fcp ?? fcp,
    lcp: finalState.lcp,
    navTiming: finalState.navTiming,
    hasMarker: finalState.hasMarker,
    telegramBlocked,
    rootChildren: finalState.rootChildren,
    traceFile,
    traceEvents,
  };
}

async function main() {
  if (!fs.existsSync(DIST)) { console.error("dist not found"); process.exit(1); }

  const origHtml = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });

  // === Variant 1: Original HTML (hidden text) ===
  fs.writeFileSync(path.join(DIST, "index.html"), origHtml);
  const server = createServer();
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  console.log(`Server (hidden): ${origin}`);

  console.log("\n=== Variant: original (hidden text) ===");
  const hiddenResults = [];
  for (const profile of PROFILES) {
    const r = await runScenario(browser, origin, profile, "hidden");
    console.log(`  ${profile.label}: FCP=${r.fcp !== null ? r.fcp.toFixed(1) + "ms" : "—"}  nav={JSON.stringify(r.navTiming)}  marker=${r.hasMarker}  telegramBlocked=${r.telegramBlocked}`);
    hiddenResults.push(r);
  }
  server.close();

  // === Variant 2: Modified HTML (visible text with marker) ===
  const modified = origHtml.replace(
    '<span class="sk-preboot__visually-hidden">جارٍ التحميل</span>',
    '<span class="fcp-diag-visible" style="display:block;color:#333;font-size:1rem;font-weight:600;padding:1rem">FCP_DIAG_VISIBLE_MARKER جارٍ التحميل</span>'
  );
  fs.writeFileSync(path.join(DIST, "index.html"), modified);

  // NEW server instance (no cache carryover)
  const server2 = createServer();
  await new Promise(r => server2.listen(0, "127.0.0.1", r));
  const port2 = server2.address().port;
  const origin2 = `http://127.0.0.1:${port2}`;
  console.log(`\nServer (visible): ${origin2}`);

  console.log("\n=== Variant: modified (visible text + marker) ===");
  const visibleResults = [];
  for (const profile of PROFILES) {
    const r = await runScenario(browser, origin2, profile, "visible");
    console.log(`  ${profile.label}: FCP=${r.fcp !== null ? r.fcp.toFixed(1) + "ms" : "—"}  nav={JSON.stringify(r.navTiming)}  marker=${r.hasMarker}  telegramBlocked=${r.telegramBlocked}`);
    visibleResults.push(r);
  }
  server2.close();

  // === Variant 3: Ablation — module script imports removed ===
  const ablation = origHtml.replace(
    /<script type="module">[\s\S]*?<\/script>/,
    '<script type="module">/* imports removed for ablation */</script>'
  );
  fs.writeFileSync(path.join(DIST, "index.html"), ablation);

  const server3 = createServer();
  await new Promise(r => server3.listen(0, "127.0.0.1", r));
  const port3 = server3.address().port;
  const origin3 = `http://127.0.0.1:${port3}`;
  console.log(`\nServer (ablation): ${origin3}`);

  console.log("\n=== Variant: ablation (module imports removed) ===");
  const ablationResults = [];
  for (const profile of [PROFILES[0], PROFILES[2]]) { // Slow 4G + CPU ×4 and No throttling only
    const r = await runScenario(browser, origin3, profile, "ablation");
    console.log(`  ${profile.label}: FCP=${r.fcp !== null ? r.fcp.toFixed(1) + "ms" : "—"}  nav={JSON.stringify(r.navTiming)}  marker=${r.hasMarker}  telegramBlocked=${r.telegramBlocked}`);
    ablationResults.push(r);
  }
  server3.close();

  // Restore
  fs.writeFileSync(path.join(DIST, "index.html"), origHtml);

  // === Summary ===
  console.log("\n=== SUMMARY ===");
  console.log("\nHidden text (original):");
  for (const r of hiddenResults) console.log(`  ${r.label}: FCP=${r.fcp !== null ? r.fcp.toFixed(1) + "ms" : "—"}  marker=${r.hasMarker}`);
  console.log("\nVisible text (modified):");
  for (const r of visibleResults) console.log(`  ${r.label}: FCP=${r.fcp !== null ? r.fcp.toFixed(1) + "ms" : "—"}  marker=${r.hasMarker}`);
  console.log("\nAblation (no imports):");
  for (const r of ablationResults) console.log(`  ${r.label}: FCP=${r.fcp !== null ? r.fcp.toFixed(1) + "ms" : "—"}  marker=${r.hasMarker}`);

  // === Trace analysis ===
  console.log("\n=== TRACE ANALYSIS ===");
  for (const r of [...hiddenResults, ...visibleResults, ...ablationResults]) {
    const events = r.traceEvents;
    // Use navigation timing for nav start
    const navTiming = r.navTiming;
    const navStart = navTiming.requestStart || 0;

    // Key milestones from trace
    const milestones = {};
    for (const e of events) {
      if (e.name === "firstPaint") milestones.firstPaint = e.ts;
      if (e.name === "firstContentfulPaint") milestones.FCP_trace = e.ts;
      if (e.name === "MarkDOMContent") milestones.DOMContentLoaded = e.ts;
    }

    // First LayoutObjectPainted with text
    let firstTextPaint = null;
    for (const e of events) {
      if (e.name === "PaintTimingVisualizer::LayoutObjectPainted" && e.args?.data?.is_aggregation_text) {
        firstTextPaint = e.ts;
        break;
      }
    }

    // Resource finish times for JS bundles
    const jsFinishes = {};
    for (const e of events) {
      if (e.ph !== "I") continue;
      const d = e.args?.data || {};
      if (e.name === "ResourceSendRequest") {
        for (const e2 of events) {
          if (e2.name === "ResourceFinish" && e2.ph === "I" && e2.args?.data?.requestId === d.requestId) {
            const url = d.url || "";
            if (url.includes("shell") || url.includes("vendor")) {
              jsFinishes[url.split("/").pop()] = e2.ts;
            }
          }
        }
      }
    }

    // Long tasks
    const longTasks = [];
    for (const e of events) {
      if (e.name === "RunTask" && e.ph === "X" && e.dur > 50000) {
        longTasks.push({ ts: e.ts, dur: e.dur });
      }
    }

    console.log(`\n--- ${r.variant} / ${r.label} ---`);
    console.log(`  Performance API FCP: ${r.fcp !== null ? r.fcp.toFixed(1) + "ms" : "—"}`);
    console.log(`  Navigation timing: requestStart=${navTiming.requestStart}  responseStart=${navTiming.responseStart}  responseEnd=${navTiming.responseEnd}`);
    if (milestones.firstPaint) console.log(`  Trace firstPaint: ${(milestones.firstPaint / 1000).toFixed(1)}ms (absolute)`);
    if (milestones.FCP_trace) console.log(`  Trace FCP: ${(milestones.FCP_trace / 1000).toFixed(1)}ms (absolute)`);
    if (firstTextPaint) console.log(`  First text paint: ${(firstTextPaint / 1000).toFixed(1)}ms (absolute)`);
    for (const [name, ts] of Object.entries(jsFinishes)) {
      console.log(`  ${name} finish: ${(ts / 1000).toFixed(1)}ms (absolute)`);
    }
    if (longTasks.length > 0) {
      for (const lt of longTasks) console.log(`  Long task: ${(lt.ts / 1000).toFixed(1)}ms (absolute)  dur=${(lt.dur / 1000).toFixed(0)}ms`);
    }
    // Note: trace timestamps are in microseconds from process start, not from navigation
    // Performance API times are from navigation start
    // So we compute relative times from FCP
    if (r.fcp !== null && milestones.FCP_trace) {
      const traceFcpRelative = r.fcp; // Performance API FCP in ms from nav start
      // Trace FCP is absolute; we need to find the offset
      // traceFcpAbsolute = navStartAbsolute + traceFcpRelative
      // So navStartAbsolute = traceFcpAbsolute - traceFcpRelative
      const navStartAbs = milestones.FCP_trace - (r.fcp * 1000);
      console.log(`  Computed navStart (trace): ${(navStartAbs / 1000).toFixed(1)}ms`);
      if (milestones.firstPaint) console.log(`  firstPaint (relative): ${((milestones.firstPaint - navStartAbs) / 1000).toFixed(1)}ms`);
      if (firstTextPaint) console.log(`  First text paint (relative): ${((firstTextPaint - navStartAbs) / 1000).toFixed(1)}ms`);
      for (const [name, ts] of Object.entries(jsFinishes)) {
        console.log(`  ${name} finish (relative): ${((ts - navStartAbs) / 1000).toFixed(1)}ms`);
      }
      for (const lt of longTasks) {
        console.log(`  Long task (relative): ${((lt.ts - navStartAbs) / 1000).toFixed(1)}ms  dur=${(lt.dur / 1000).toFixed(0)}ms`);
      }
    }
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
