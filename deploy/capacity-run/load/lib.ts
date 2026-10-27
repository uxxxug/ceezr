/* biome-ignore-all lint/style/noNonNullAssertion: أداة حمل تجريبية — الصفوف مضمونة بالبذر وفشلها يُسجَّل */
/**
 * R1 · ADR 0286 — مكتبةُ مولّداتِ الحملِ المشتركةُ بينَ المساراتِ.
 *
 * مبادئُ (منَ التكليفِ والجولةِ السابقةِ):
 * 1) **مساراتٌ منفصلةٌ لا مقياساً واحداً**: كلُّ مولّدٍ يوسمُ أحداثَه بمسارِهِ
 *    (`path`)، و429 لا تُخلطُ في مقياسٍ واحدٍ: `webhook_inbound` · `miniapp_api` ·
 *    `telegram_outbound` عدّاداتٌ منفصلةٌ.
 * 2) **النجاحُ حكمُ القاعدةِ لا حكمُ 2xx**: كلُّ سيناريوٍ يُختمُ بتحققٍ منَ
 *    الحالةِ النهائيةِ في قاعدةِ البياناتِ، والمرفوضُ والمتعثرُ وغيرُ المحسومِ
 *    يُعدَّانِ في المقامِ لا يُحذفانِ.
 * 3) **لا أسرارَ في الأدلةِ**: لا يُسجَّل initData خامٌ ولا رمزُ بوتٍ ولا bearer —
 *    المعرفاتُ وحدها.
 * 4) **لكلِّ نداءٍ مهلةٌ** (AbortSignal.timeout) ولا انتظارَ بلا سقفٍ، وإعادةُ
 *    المحاولةِ ذاتُ سقفٍ وتحترمُ `Retry-After`.
 */

import { createHmac } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import postgres from "postgres";
import { startLoopProbe } from "../../../packages/infrastructure/observability/loop-probe.ts";
import { fetchGate, type SlotInfo } from "./fetch-gate.ts";

export const RUN_DIR = process.env.RUN_DIR ?? "/tmp/cap-run";
export const EV = `${RUN_DIR}/evidence`;
mkdirSync(EV, { recursive: true });
/**
 * عنوانُ البوّابةِ — يُحلُّ **وقتَ النداءِ** لا وقتَ تحميلِ الوحدةِ (كما RUN_DIR): الوحدةُ
 * قد تُحمَّلُ في اختباراتٍ كثيرةٍ ببيئاتٍ متغايرةٍ ثمَّ يُبدَّلُ GATEWAY_URL، فلا يُقفَلَ
 * العنوانُ على أولِ بيئةٍ. ‏(BASE المصدَّرُ يبقى لمن يريدُ قيمةً وقتَ التحميلِ.)
 */
export function gatewayBase(): string {
  return process.env.GATEWAY_URL ?? "http://127.0.0.1:54300";
}
export const BASE = gatewayBase();
export const DB_URL = process.env.DATABASE_URL ?? "";
export const GEN_ID = process.env.GEN_ID ?? "gen1";

export const sql = postgres(
  DB_URL === ""
    ? `postgres://127.0.0.1:5/none?application_name=${GEN_ID}`
    : `${DB_URL}?application_name=${GEN_ID}`,
  {
    max: 8,
    idle_timeout: 20,
    connect_timeout: 10,
  },
);

export const T0 = Date.now();
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/* ───────── توقيعُ initData (مخطّطُ WebAppData الرسميُّ) ───────── */

export interface InitDataOptions {
  readonly botToken: string;
  readonly telegramId: number;
  readonly firstName?: string;
  readonly languageCode?: string;
  readonly startParam?: string;
  readonly authDateSeconds?: number;
}

/**
 * يوقّعُ بياناتٍ كما يوقّعُها تيليجرامُ: `secret = HMAC("WebAppData", botToken)`
 * ثمَّ `hash = HMAC(secret, dataCheckString)`. التحققُ في البوابةِ حقيقيٌّ غيرُ معدَّلٍ
 * (بوتٌ اصطناعيٌّ في البيئةِ المعزولةِ) — والمولّدُ يعرفُ رمزَ البوتِ لأنَّهُ
 * جزءٌ منَ البيئةِ لا منَ مستخدمٍ حقيقيٍّ.
 */
export function signedInitData(opts: InitDataOptions): string {
  const authDate = Math.floor(opts.authDateSeconds ?? Date.now() / 1000);
  const user = JSON.stringify({
    id: opts.telegramId,
    first_name: opts.firstName ?? `cap${GEN_ID}`,
    language_code: opts.languageCode ?? "ar",
  });
  const pairs: [string, string][] = [
    ["auth_date", String(authDate)],
    ["user", user],
    ...(opts.startParam === undefined
      ? []
      : ([["start_param", opts.startParam]] as [string, string][])),
  ];
  const checkString = pairs
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(opts.botToken).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  return new URLSearchParams([...pairs, ["hash", hash]]).toString();
}

/* ───────── عميلُ HTTP مصنِّفٌ ───────── */

export interface HttpResult {
  readonly status: number;
  readonly ok: boolean;
  readonly is429: boolean;
  readonly elapsedMs: number;
  readonly body: Record<string, unknown> | null;
  readonly networkError: string | null;
  /**
   * `LOAD-01` — معرّفُ الطلبِ من الخادمِ (`x-request-id` — لا رأسًا من العميلِ
   * يُوقَّعُ عليه)، لربطِ زمنِ العميلِ بأطوارِ الخادمِ للطلبِ نفسِهِ في السجلِ.
   */
  readonly requestId: string | null;
  /**
   * فصلُ زمنِ العميلِ (أداةُ فصلِ الفجوةِ، 2026-10-26): `ttfbMs` = من بدءِ النداءِ حتى
   * حلِّ `fetch` (استلامُ ترويساتِ الردّ) و`bodyMs` = قراءةُ جسمِ الردّ وتحليلُه بعدَها.
   * بلا تبديلَ لـ`fetch` ولا لقارئِ الجسمِ — النداءُ والقراءةُ كما كانا وفقطَ تُلتقطُ
   * اللحظتانُ الموجودتانِ أصلًا بينَ `await` المتتاليينِ. null عندَ الفشلِ الشبكيِّ
   * (المسارُ يمرُّ عبرَ catch فلا ترويساتِ ولا جسمٌ).
   */
  readonly ttfbMs: number | null;
  readonly bodyMs: number | null;
  /**
   * LOAD-01-GAP-PROBE-RUN2 (2026-10-27) — ما قبلَ `fetch` وحالُ المولّدِ حولَه، بساعتِهِ وحدَها:
   * `invokeMs` = بدءُ النداءِ ← لحظةَ استدعاءِ `fetch` مباشرةً (تحضيرُ الترويساتِ والجسم)؛
   * `inflightAtInvoke` = نداءاتُ `fetch` الجاريةُ في هذهِ العمليّةِ لحظتَها (شاملًا هذا) — حدُّ Bun
   * الموثَّقُ 256 يُصفُّ ما فوقَهُ **داخلَ** `fetch` فلا يراهُ الخادم؛ `headersOverdueMs` = مؤشّرُ
   * مِجسِّ الحلقةِ لحظةَ حلِّ `fetch` (null بلا مِجسّ) — مؤشّرٌ لا مُكوِّن.
   */
  readonly invokeMs: number | null;
  readonly inflightAtInvoke: number | null;
  readonly headersOverdueMs: number | null;
  /**
   * LOAD-01-GAP-PROBE-RUN3 (2026-10-27) — بوابةُ `fetch` المقيسةُ (`fetch-gate.ts`): `queueWaitMs` = انتظارُ
   * الفتحةِ بعدَ `invokeMs` وقبلَ استدعاءِ `fetch` (0 بلا سعة)؛ `waitersAtInvoke` المنتظرونَ أمامَه؛
   * `activeAtSend` الجاريةُ لحظةَ الإرسالِ (شاملًا)؛ `demandAtInvoke` الجاريةُ + المنتظرونَ + هذا، لكلِّ
   * `fetch` في العمليّة (التسجيلُ أيضًا). `ttfbMs` يبقى من بدءِ النداءِ فيشملُ الانتظارَ — لا يُخفى شيء.
   */
  readonly queueWaitMs: number | null;
  readonly waitersAtInvoke: number | null;
  readonly activeAtSend: number | null;
  readonly demandAtInvoke: number | null;
  readonly fetchCap: number | null;
}

/** نداءاتُ `fetch` الجاريةُ في هذهِ العمليّة (عبرَ `http`) — عدٌّ لا يغيّرُ سلوكًا. */
let fetchInFlight = 0;
/** مِجسُّ حلقةِ المولّدِ إن شُغِّل (`setClientLoopOverdue`) — بلا مِجسٍّ تبقى المؤشّراتُ null. */
let clientLoopOverdue: (() => number) | null = null;
export function setClientLoopOverdue(fn: (() => number) | null): void {
  clientLoopOverdue = fn;
}

/**
 * مِجسُّ حلقةِ المولّدِ (LOAD-01-GAP-PROBE-RUN2) — خلفَ `DISPATCH_TRACE_FILE` وحدَه كعمودِ
 * `http_call`: سطرُ `gen_env` مرّةً (حدُّ `BUN_CONFIG_MAX_HTTP_REQUESTS` كما في البيئةِ — null
 * إن لم يُضبط فالافتراضيُّ الموثَّقُ 256 — وإصدارُ Bun والمعرّف)، ثمَّ `gen_loop` كلَّ ثانيةٍ في
 * `load-events.jsonl`، ويُمرَّرُ مؤشّرُ التأخّرِ إلى `http`. بلا علمٍ يُعيدُ null ولا يبدأُ شيء.
 */
export function startClientLoopProbe(
  path: string,
  gen: string,
  opts: { intervalMs?: number; sampleMs?: number } = {},
): (() => void) | null {
  if (process.env.DISPATCH_TRACE_FILE === undefined || process.env.DISPATCH_TRACE_FILE === "")
    return null;
  const file = `${process.env.RUN_DIR ?? "/tmp/cap-run"}/evidence/load-events.jsonl`;
  const write = (row: Record<string, unknown>): void =>
    appendFileSync(file, `${JSON.stringify({ t: new Date().toISOString(), path, gen, ...row })}\n`);
  write({
    event: "gen_env",
    pid: process.pid,
    bunVersion: typeof Bun === "undefined" ? null : Bun.version,
    maxHttpRequestsEnv: process.env.BUN_CONFIG_MAX_HTTP_REQUESTS ?? null,
    // RUN3: سعةُ بوابةِ المولّدِ كما في البيئة (null = بلا حدٍّ صريح) والمفعولةُ فعلًا.
    fetchCapEnv: process.env.LOAD_GEN_FETCH_CAP ?? null,
    fetchCap: fetchGate().cap,
  });
  // RUN3: عدّاداتُ البوابةِ لكلِّ ثانيةٍ — معدّلُ النداءِ والإرسالِ والإكمالِ والمنتظرون (في الذراعينِ معًا).
  const semTimer = setInterval(
    () => write({ event: "gen_sem", at: Date.now(), ...fetchGate().takeSample() }),
    opts.sampleMs ?? 1_000,
  );
  const probe = startLoopProbe({
    intervalMs: opts.intervalMs ?? 10,
    sampleMs: opts.sampleMs ?? 1_000,
    emit: (sample) => write({ event: "gen_loop", ...sample }),
  });
  setClientLoopOverdue(() => probe.overdueMs());
  return () => {
    clearInterval(semTimer);
    probe.stop();
    setClientLoopOverdue(null);
  };
}

export async function http(
  path: string,
  init: {
    method?: string;
    token?: string;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<HttpResult> {
  const started = performance.now();
  let invokeMs: number | null = null;
  let inflightAtInvoke: number | null = null;
  let counted = false;
  let slot: SlotInfo | null = null;
  let held = false;
  const gate = fetchGate();
  try {
    const url = `${gatewayBase()}${path}`;
    const reqInit: RequestInit = {
      method: init.method ?? "GET",
      headers: {
        ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
    };
    fetchInFlight += 1;
    counted = true;
    inflightAtInvoke = fetchInFlight;
    invokeMs = performance.now() - started;
    // RUN3: الفتحةُ بعدَ invokeMs وقبلَ fetch — المسارُ السريعُ متزامن (بلا سعةٍ: لا قفزةَ إضافيّة).
    slot = gate.tryAcquire() ?? (await gate.acquire(reqInit.signal ?? undefined));
    held = true;
    const response = await fetch(url, reqInit);
    const ttfb = performance.now() - started;
    const headersOverdueMs = clientLoopOverdue === null ? null : clientLoopOverdue();
    let body: Record<string, unknown> | null = null;
    let bodyMs: number | null = null;
    try {
      body = (await response.json()) as Record<string, unknown>;
      bodyMs = performance.now() - started - ttfb;
    } catch {
      body = null;
    }
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      is429: response.status === 429,
      elapsedMs: performance.now() - started,
      body,
      networkError: null,
      requestId: response.headers.get("x-request-id"),
      ttfbMs: Math.round(ttfb * 100) / 100,
      bodyMs: bodyMs === null ? null : Math.round(bodyMs * 100) / 100,
      invokeMs: Math.round(invokeMs * 100) / 100,
      inflightAtInvoke,
      headersOverdueMs: headersOverdueMs === null ? null : Math.round(headersOverdueMs * 100) / 100,
      ...slotFields(slot, gate.cap),
    };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      is429: false,
      elapsedMs: performance.now() - started,
      body: null,
      networkError: error instanceof Error ? error.name : "network",
      // لا استجابةَ فلا معرّفَ طلبٍ — والفشلُ الصفريُّ بلا رأسٍ منَ الخادمِ أصلاً.
      requestId: null,
      // ولا ترويساتِ ولا جسمٌ فلا حدَّينِ يُفصلانِ عندَ العميلِ — null لا صفرٌ.
      ttfbMs: null,
      bodyMs: null,
      invokeMs: invokeMs === null ? null : Math.round(invokeMs * 100) / 100,
      inflightAtInvoke,
      headersOverdueMs: null,
      ...slotFields(slot, gate.cap),
    };
  } finally {
    // حدُّ Bun يعدُّ الطلبَ حتى انتهائِهِ (الجسمُ مقروءٌ) — فالعدُّ يُنقصُ هنا لا عندَ الترويسات.
    if (counted) fetchInFlight -= 1;
    // والفتحةُ تُحرَّرُ في اللحظةِ نفسِها؛ إلغاءٌ أثناءَ الانتظارِ لم يحجزْ فتحةً فلا تحرير.
    if (held) gate.release();
  }
}

function slotFields(
  slot: SlotInfo | null,
  cap: number | null,
): Pick<
  HttpResult,
  "queueWaitMs" | "waitersAtInvoke" | "activeAtSend" | "demandAtInvoke" | "fetchCap"
> {
  return {
    queueWaitMs: slot === null ? null : Math.round(slot.queueWaitMs * 100) / 100,
    waitersAtInvoke: slot?.waitersAtInvoke ?? null,
    activeAtSend: slot?.activeAtSend ?? null,
    demandAtInvoke: slot?.demandAtInvoke ?? null,
    fetchCap: cap,
  };
}

/* ───────── مقاييسُ المسارِ — 429 مفكَّكةٌ لا مختلطةٌ ───────── */

export type Path429Class = "webhook_inbound" | "miniapp_api" | "telegram_outbound";

export interface PathMetrics {
  readonly path: string;
  readonly gen: string;
  /** صنفُ 429 لنداءاتِ هذا المسارِ نفسِهِ — فلا يُخلطُ مسارٌ في مقياسِ غيرِهِ. */
  readonly class429?: Path429Class;
}

const WINDOW_MS = 10_000;

export class PathRecorder {
  private readonly path: string;
  private readonly gen: string;
  private active = 0;
  private peakActive = 0;
  private httpInFlight = 0;
  private peakHttpInFlight = 0;
  private readonly users = new Set<string>();
  private readonly windowUsers = new Set<string>();
  private counters = {
    scenariosStarted: 0,
    scenariosDone: 0,
    http2xx: 0,
    webhookInbound429: 0,
    api429: 0,
    http5xx: 0,
    http4xx: 0,
    networkErrors: 0,
    // نتائجُ الأعمالِ — حكمُ القاعدةِ لا حكمُ 2xx:
    businessVerified: 0,
    businessRejected: 0,
    businessUndecided: 0,
  };
  private lastSnapshot = T0;

  private readonly class429: Path429Class;
  private readonly label429: "webhookInbound429" | "api429";

  constructor(metrics: PathMetrics) {
    this.path = metrics.path;
    this.gen = metrics.gen;
    this.class429 = metrics.class429 ?? "miniapp_api";
    this.label429 = this.class429 === "webhook_inbound" ? "webhookInbound429" : "api429";
  }

  scenarioStart(user: string): void {
    this.active += 1;
    this.counters.scenariosStarted += 1;
    this.users.add(user);
    this.windowUsers.add(user);
    if (this.active > this.peakActive) this.peakActive = this.active;
  }

  scenarioEnd(outcome: "verified" | "rejected" | "undecided"): void {
    this.active -= 1;
    this.counters.scenariosDone += 1;
    if (outcome === "verified") this.counters.businessVerified += 1;
    else if (outcome === "rejected") this.counters.businessRejected += 1;
    else this.counters.businessUndecided += 1;
  }

  httpStart(): void {
    this.httpInFlight += 1;
    if (this.httpInFlight > this.peakHttpInFlight) this.peakHttpInFlight = this.httpInFlight;
  }

  /** عيّناتُ زمنِ الاستجابةِ لكلِّ مسارٍ (تسميةِ نداءٍ) — تُحوَّلُ مئيناتٍ في
   *  اللقطةِ: مطلوبةٌ لمعاييرِ القبولِ المعلنةِ مسبقًا (p50/p95/p99). */
  private readonly latencies = new Map<string, number[]>();

  httpLatency(label: string, elapsedMs: number): void {
    const arr = this.latencies.get(label);
    if (arr === undefined) this.latencies.set(label, [elapsedMs]);
    else arr.push(elapsedMs);
  }

  /**
   * `LOAD-01` (تشخيصُ انتظارِ HTTP، 2026-10-26) — عمودُ العميلِ: سطرٌ **فرديٌّ لكلِّ نداءٍ**
   * في `load-events.jsonl` يحملُ معرّفَ الطلبِ منَ الخادمِ (`requestId` — المارَّ فعلًا في رأسِ
   * `X-Request-Id`) وزمنَ العميلِ الكاملَ، فيُربَطُ نداءُ العميلِ بطلبِ الخادمِ مباشرةً وتُقاسُ
   * فجوةُ العميل/الخادمِ فصلًا. ممرٌّ جديدٌ لا يجمعُ: لا مئيناتٍ ولا نوافذَ — العينةُ نفسُها.
   */
  httpCallLog(label: string, result: HttpResult): void {
    // خلفَ `DISPATCH_TRACE_FILE` وحدَهِ — العلمُ نفسُهِ الذي تُقرؤُهُ البوّابةُ (يصلُ المولّدَ
    // عبرَ secrets.env التي يحمّلُها wave.sh) — فيقيسُ فحصُ ON–OFF كلفةَ الأداةِ في
    // الجانبينِ معًا، ولا يعملُ شيءٌ من التسجيلِ الجديدِ في الحالتينِ معًا.
    if (process.env.DISPATCH_TRACE_FILE === undefined || process.env.DISPATCH_TRACE_FILE === "")
      return;
    // المسارُ يُحلُّ وقتَ النداءِ لا وقتَ تحميلِ الوحدةِ: سطرُ العميلِ يُكتبُ حيثُ يشيرُ
    // RUN_DIR لحظةَ الكتابةِ (الوحدةُ قد تُحمَّلُ في اختباراتٍ كثيرةٍ ببيئاتٍ متغايرةٍ).
    appendFileSync(
      `${process.env.RUN_DIR ?? "/tmp/cap-run"}/evidence/load-events.jsonl`,
      `${JSON.stringify({
        t: new Date().toISOString(),
        sinceStartMs: Date.now() - T0,
        path: this.path,
        gen: this.gen,
        event: "http_call",
        label,
        status: result.status,
        elapsedMs: Math.round(result.elapsedMs * 100) / 100,
        requestId: result.requestId,
        ttfbMs: result.ttfbMs,
        bodyMs: result.bodyMs,
        invokeMs: result.invokeMs,
        inflightAtInvoke: result.inflightAtInvoke,
        headersOverdueMs: result.headersOverdueMs,
        queueWaitMs: result.queueWaitMs,
        waitersAtInvoke: result.waitersAtInvoke,
        activeAtSend: result.activeAtSend,
        demandAtInvoke: result.demandAtInvoke,
        fetchCap: result.fetchCap,
      })}\n`,
    );
  }

  latencyPercentiles(): Record<
    string,
    { n: number; p50: number; p95: number; p99: number; max: number }
  > {
    const out: Record<string, { n: number; p50: number; p95: number; p99: number; max: number }> =
      {};
    for (const [label, arr] of this.latencies) {
      if (arr.length === 0) continue;
      const sorted = [...arr].sort((a, b) => a - b);
      const at = (q: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
      const top = sorted[sorted.length - 1] ?? 0;
      out[label] = {
        n: sorted.length,
        p50: Math.round(at(0.5)),
        p95: Math.round(at(0.95)),
        p99: Math.round(at(0.99)),
        max: Math.round(top),
      };
    }
    return out;
  }

  httpEnd(result: HttpResult): void {
    this.httpInFlight -= 1;
    if (result.networkError !== null) this.counters.networkErrors += 1;
    else if (result.is429) this.counters[this.label429] += 1;
    else if (result.status >= 500) this.counters.http5xx += 1;
    else if (result.status >= 400) this.counters.http4xx += 1;
    else if (result.ok) this.counters.http2xx += 1;
  }

  /** واقعةُ 429 منَ مصدرٍ آخرَ (محاكي الصادرِ مثلًا) تُحتسبُ في صنفِها لا في صنفِ
   *  النداءِ نفسِهِ — فلا تُعدَّ الواقعةُ مرتينِ. */
  external429(klass: Path429Class): void {
    if (klass === "telegram_outbound") {
      this.counters.api429 += 1; // يُفصَلُ أدناه في تسميةِ الحدثِ لا في العدّادِ
    }
  }

  snapshot(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastSnapshot < WINDOW_MS) return;
    this.lastSnapshot = now;
    const row = {
      t: new Date(now).toISOString(),
      sinceStartMs: now - T0,
      path: this.path,
      gen: this.gen,
      activeScenarios: this.active,
      peakScenarios: this.peakActive,
      httpInFlight: this.httpInFlight,
      peakHttpInFlight: this.peakHttpInFlight,
      windowUsers: this.windowUsers.size,
      totalUsers: this.users.size,
      ...this.counters,
    };
    appendFileSync(`${EV}/load-events.jsonl`, `${JSON.stringify(row)}\n`);
    this.windowUsers.clear();
  }

  finalSnapshot(): void {
    appendFileSync(
      `${EV}/load-events.jsonl`,
      `${JSON.stringify({
        t: new Date().toISOString(),
        sinceStartMs: Date.now() - T0,
        path: this.path,
        gen: this.gen,
        event: "latency_percentiles",
        ...this.latencyPercentiles(),
      })}\n`,
    );
  }
}

/* ───────── تحققُ القاعدةِ — نجاحُ الأعمالِ حكمُها ───────── */

export interface OrderFinalState {
  readonly status: string;
  readonly assignedDriverId: string | null;
  readonly matchedAt: string | null;
}

export async function orderState(orderId: string): Promise<OrderFinalState | null> {
  const rows = await sql<OrderFinalState[]>`
    select status::text as status, assigned_driver_id::text as "assignedDriverId",
           matched_at::text as "matchedAt"
      from orders where id = ${orderId}
  `;
  return rows[0] ?? null;
}

/** معيارُ I1 في كلِّ لحظةٍ: صفرُ سائقينَ يظهرونَ ملتزمينَ بأكثرَ منَ التزامٍ واحدٍ. */
export async function engagedDuplicates(): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from (
      select assigned_driver_id from orders
       where assigned_driver_id is not null and is_driver_engaged_order_status(status)
       group by assigned_driver_id having count(*) > 1
    ) as d
  `;
  return Number(rows[0]?.count ?? "0");
}
