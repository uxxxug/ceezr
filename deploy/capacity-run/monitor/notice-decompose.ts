#!/usr/bin/env bun
/**
 * LOAD-01 — تفكيكُ عمرِ إشعاراتِ صندوقِ الصادرِ المعلّقةِ (P7 / G4) إلى أسبابِه، من أثرِ المحاولاتِ
 * (`notification.attempt`) ومن صفوفِ الصندوقِ ولقطةِ التدقيقِ بعدَ الموجة. أداةُ قياسٍ لا تمسُّ المنتج.
 *
 * الاستعمال (على المقعد، قبلَ رفعِ أيِّ شيء — سجلُّ البوّابةِ لا يُرفَعُ):
 *   bun deploy/capacity-run/monitor/notice-decompose.ts \
 *     --log <gateway.wave.log> --rows <notice-rows.csv> --audit <db-audit-post.json> \
 *     --kind rider_trip_notice --out <dir>
 *
 * المخرجات (أرقامٌ ومعرّفاتُ صفوفٍ عشوائيّةٌ وحدَها — لا محادثةَ ولا هاتفَ ولا نصّ):
 *   notice-decompose.json   الملخّصُ والحكمُ على كفايةِ القياس
 *   notice-trace.jsonl      سطرٌ لكلِّ صفٍّ معلَّقٍ عندَ التدقيق + عيّنةٌ من المُسلَّمة: مقاطعُه الزمنيّة
 *
 * إعادةُ البناء: عمرُ صفٍّ عندَ لحظةِ التدقيقِ T يُقسَمُ بلا تداخلٍ إلى:
 *   queue_unclaimed   الصفُّ مستحقٌّ ولم يُلتقَطْ (انتظارُ الطابور)
 *   lane_wait         التُقِطَ وانتظرَ مسارَ محادثتِه في الشوطِ المتزامن (انتظارُ الطابورِ أيضًا)
 *   limiter_requeue   أُعيدَ بـ`OutboundCongestionError` فانتظرَ 1000ms عمدًا (محدّدُ المعدّل)
 *   queue_after_limiter  ما زادَ على تلك المهلةِ حتى التُقِطَ ثانيةً — طابورٌ سببُه إعادةُ المحدّد (يُفصَلُ
 *                     عن queue_unclaimed كي لا يُنسَبَ أثرُ المحدّدِ غيرُ المباشرِ إلى الطابورِ وحدَه)
 *   limiter_inline    نومُ المُرسِلِ لفتحةِ دلوِ المحادثةِ/الدلوِ العالميِّ داخلَ المحاولة (محدّدُ المعدّل)
 *   limiter_acquire   زمنُ سؤالِ الدلوِ نفسِه (Redis) داخلَ المحاولة
 *   telegram_api      نداءُ تيليجرامَ الفعليّ (+ نومُ 429 والإعاداتِ العابرة: telegram_backoff)
 *   processing        باقي زمنِ المحاولة: استعلاماتُ المعالجِ وإنهاءُ الصفِّ (تصريفُ الصادر)
 *   app_ack_wait      انتظارُ إقرارِ التطبيقِ المتعمَّدُ بعدَ الإشارة (`signal_wait`)
 *   retry_gap         ما بعدَ فشلٍ أُعيدَ بموعدٍ لا يُسجِّلُه الأثر (غيرُ مُفكَّك)
 *   in_flight         محاولةٌ جاريةٌ عندَ T
 * والتحقّقُ: أقصى عمرٍ مُعادِ البناءِ للنوعِ يجبُ أن يطابقَ `pendingAgeByKind` في اللقطةِ (±2ث)،
 * وكلُّ صفٍّ معلَّقٍ في اللقطةِ يجبُ أن يُرى؛ وإلّا فالحكمُ «فجوةُ قياس» لا نسبة.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Outcome =
  | "telegram"
  | "board"
  | "signal_wait"
  | "congestion"
  | "retry"
  | "dead"
  | "abandon"
  | "undeliverable"
  | "no_message"
  | "error"
  /** حُسِمَ الصفُّ في القاعدةِ خارجَ العامل (مثلًا تأكيدُ التطبيق `miniapp_ack` بـSQL مباشر) — لا محاولةَ له. */
  | "external";

const TERMINAL: ReadonlySet<Outcome> = new Set([
  "telegram",
  "board",
  "dead",
  "abandon",
  "undeliverable",
  "no_message",
]);

export interface Attempt {
  readonly deliveryId: string;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly laneWaitMs: number | null;
  readonly outcome: Outcome;
  readonly retryAfterMs: number | null;
  readonly metered: boolean;
  readonly acquireMs: number;
  readonly chatWaitMs: number;
  readonly globalWaitMs: number;
  readonly congestionScope: "chat" | "global" | null;
  readonly apiMs: number;
  readonly throttleWaitMs: number;
  readonly retryWaitMs: number;
}

export interface Row {
  readonly id: string;
  readonly kind: string;
  readonly event: string | null;
  readonly createdMs: number;
  /**
   * وقتُ الحسمِ في القاعدة (delivered_at/died_at) إن حُسِمَ؛ يُستعملُ حصرًا حينَ لا محاولةَ نهائيّةً
   * قبلَه في الأثر — أي حُسِمَ خارجَ العامل (تأكيدُ التطبيقِ يحدّثُ الصفَّ مباشرةً بلا سطرِ محاولة).
   */
  readonly settledMs?: number | null;
  /** قناةُ/حالةُ الحسمِ الآمنة (`miniapp_ack`، `dead`…) — رمزٌ قصيرٌ لا نصّ. */
  readonly settledVia?: string | null;
}

export const SEGMENTS = [
  "queue_unclaimed",
  "lane_wait",
  "limiter_requeue",
  "queue_after_limiter",
  "limiter_inline",
  "limiter_acquire",
  "telegram_api",
  "telegram_backoff",
  "processing",
  "app_ack_wait",
  "retry_gap",
  "in_flight",
] as const;
export type Segment = (typeof SEGMENTS)[number];
export type Breakdown = Record<Segment, number>;

export function emptyBreakdown(): Breakdown {
  return Object.fromEntries(SEGMENTS.map((s) => [s, 0])) as Breakdown;
}

export interface RowTimeline {
  readonly id: string;
  readonly event: string | null;
  readonly createdMs: number;
  readonly attempts: number;
  /** نهايةُ آخرِ محاولةٍ نهائيّةٍ قبلَ T، أو `null` إن بقيَ معلّقًا عندَ T. */
  readonly terminalAtMs: number | null;
  readonly terminalOutcome: Outcome | null;
  readonly pendingAtT: boolean;
  /** محاولةٌ جاريةٌ عندَ T ⇒ حالتُه `sending` لا `pending` (لا تعدُّه اللقطة). */
  readonly sendingAtT: boolean;
  /** T − created للمعلّق، ونهايةُ التسليمِ − created للمُنتهي. */
  readonly ageMs: number;
  readonly breakdown: Breakdown;
  readonly congestionScopes: { chat: number; global: number };
  readonly unmeteredAttempts: number;
  /** قناةُ الحسمِ الخارجيّ إن كانت `terminalOutcome = external`. */
  readonly settledVia?: string | null;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * يقسمُ [created, min(T, نهاية)] لصفٍّ واحدٍ إلى مقاطعَ لا تتداخل. المحاولاتُ مرتّبةٌ ببدئها،
 * وما بدأَ بعدَ T لا يُحتسب. مجموعُ المقاطعِ = ageMs (يثبّتُه اختبار).
 */
export function timelineOf(row: Row, attemptsIn: readonly Attempt[], tMs: number): RowTimeline {
  const r = traceTimeline(row, attemptsIn, tMs);
  const s = row.settledMs;
  if (r.terminalAtMs !== null || s === null || s === undefined || !(s < tMs)) return r;
  // حُسِمَ خارجَ العاملِ قبلَ T: يُقطعُ الخطُّ الزمنيُّ عندَ الحسمِ ويُعدُّ مُنتهيًا لا معلّقًا.
  const at = Math.max(row.createdMs, s);
  const cut = traceTimeline(row, attemptsIn, at);
  return {
    ...cut,
    terminalAtMs: at,
    terminalOutcome: "external",
    pendingAtT: false,
    sendingAtT: false,
    ageMs: at - row.createdMs,
    settledVia: row.settledVia ?? null,
  };
}

function traceTimeline(row: Row, attemptsIn: readonly Attempt[], tMs: number): RowTimeline {
  const attempts = [...attemptsIn]
    .filter((a) => a.startedAtMs < tMs)
    .sort((a, b) => a.startedAtMs - b.startedAtMs);
  const b = emptyBreakdown();
  const scopes = { chat: 0, global: 0 };
  let cursor = row.createdMs;
  let dueAt = row.createdMs;
  let scheduledAs: Segment = "queue_unclaimed";
  let terminalAtMs: number | null = null;
  let terminalOutcome: Outcome | null = null;
  let unmetered = 0;
  let used = 0;
  let sending = false;
  // ما يتجاوزُ موعدَ الاستحقاقِ: بعدَ إعادةِ المحدّدِ يُحسَبُ queue_after_limiter، وإلّا queue_unclaimed.
  const overflowAs = (): Segment =>
    scheduledAs === "limiter_requeue" ? "queue_after_limiter" : "queue_unclaimed";
  const gap = (until: number) => {
    const g = Math.max(0, until - cursor);
    if (g === 0) return;
    if (scheduledAs === "retry_gap") {
      b.retry_gap += g;
      return;
    }
    const scheduled = clamp(dueAt - cursor, 0, g);
    b[scheduledAs] += scheduled;
    return g - scheduled;
  };
  for (const a of attempts) {
    used += 1;
    const start = Math.max(a.startedAtMs, cursor);
    const queueLeft = gap(start) ?? 0;
    // انتظارُ المسارِ يسبقُ البدءَ مباشرةً (الالتقاطُ ثمّ الانتظارُ ثمّ البدء).
    const lane = clamp(a.laneWaitMs ?? 0, 0, queueLeft);
    b.lane_wait += lane;
    b[overflowAs()] += queueLeft - lane;
    const end = start + Math.max(0, a.durationMs);
    if (end > tMs) {
      b.in_flight += tMs - start;
      cursor = tMs;
      sending = true;
      break;
    }
    const dur = end - start;
    if (!a.metered) unmetered += 1;
    let left = dur;
    const take = (seg: Segment, ms: number) => {
      const x = clamp(ms, 0, left);
      b[seg] += x;
      left -= x;
    };
    take("limiter_inline", a.chatWaitMs + a.globalWaitMs);
    take("limiter_acquire", a.acquireMs);
    take("telegram_api", a.apiMs);
    take("telegram_backoff", a.throttleWaitMs + a.retryWaitMs);
    b.processing += left;
    cursor = end;
    if (a.outcome === "congestion") {
      if (a.congestionScope === "chat") scopes.chat += 1;
      else if (a.congestionScope === "global") scopes.global += 1;
    }
    if (TERMINAL.has(a.outcome)) {
      terminalAtMs = end;
      terminalOutcome = a.outcome;
      break;
    }
    if (a.outcome === "signal_wait") {
      scheduledAs = "app_ack_wait";
      dueAt = end + (a.retryAfterMs ?? 0);
    } else if (a.outcome === "congestion") {
      scheduledAs = "limiter_requeue";
      dueAt = end + (a.retryAfterMs ?? 1_000);
    } else if (a.outcome === "retry") {
      scheduledAs = "retry_gap";
      dueAt = Number.POSITIVE_INFINITY;
    } else {
      // `error`: الصفُّ عالقٌ في `sending` حتى يُستعادَ — لا موعدَ معروف.
      scheduledAs = "retry_gap";
      dueAt = Number.POSITIVE_INFINITY;
    }
  }
  const end = terminalAtMs ?? tMs;
  if (terminalAtMs === null && cursor < tMs) {
    const left = gap(tMs) ?? 0;
    b[overflowAs()] += left;
  }
  return {
    id: row.id,
    event: row.event,
    createdMs: row.createdMs,
    attempts: used,
    terminalAtMs,
    terminalOutcome,
    pendingAtT: terminalAtMs === null && row.createdMs < tMs,
    sendingAtT: sending,
    ageMs: Math.max(0, end - row.createdMs),
    breakdown: b,
    congestionScopes: scopes,
    unmeteredAttempts: unmetered,
  };
}

/** الأسئلةُ الثلاثةُ للتكليف: الطابور، ومحدّدُ تيليجرام، ومعالجةُ/تصريفُ الصادر — وما خارجَها. */
export function groupsOf(b: Breakdown) {
  return {
    queue_wait: b.queue_unclaimed + b.lane_wait,
    telegram_limiter: b.limiter_requeue + b.limiter_inline,
    queue_after_limiter: b.queue_after_limiter,
    outbox_processing: b.processing + b.limiter_acquire,
    telegram_api: b.telegram_api + b.telegram_backoff,
    app_ack_wait: b.app_ack_wait,
    unattributed: b.retry_gap + b.in_flight,
  };
}

function addInto(acc: Breakdown, x: Breakdown) {
  for (const s of SEGMENTS) acc[s] += x[s];
}

function pct(x: number, total: number) {
  return total > 0 ? Math.round((1000 * x) / total) / 10 : null;
}

function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] ?? null;
}

export interface PassWindow {
  readonly startMs: number;
  readonly endMs: number;
  readonly stop: string | null;
  /** حقولُ الشوطِ الرقميّةُ من `detail` (`claimed`، `claim_ms`…) — غائبةٌ في سجلٍّ أقدم. */
  readonly fields?: Readonly<Record<string, number>>;
}

/** حقولُ الشوطِ المجمَّعة: ما يفصلُ «الالتقاطَ المتسلسل» عن «انتظارِ المسارات» عن «الإرسال». */
export const PASS_FIELDS = [
  "claimed",
  "elapsed_ms",
  "claim_calls",
  "claim_ms",
  "send_ms",
  "lane_wait_ms",
  "lane_full_wait_ms",
  "saturated_wait_ms",
  "congestion_sleep_ms",
  "congestion_requeues",
] as const;

export function passTotalsOf(passes: readonly PassWindow[]) {
  const totals: Record<string, number> = {};
  let withClaimMs = 0;
  for (const p of passes) {
    if (p.fields?.claim_ms !== undefined) withClaimMs += 1;
    for (const f of PASS_FIELDS) {
      const v = p.fields?.[f];
      if (v !== undefined) totals[f] = (totals[f] ?? 0) + v;
    }
  }
  const el = totals.elapsed_ms;
  const share = (f: string) =>
    el !== undefined && el > 0 && totals[f] !== undefined
      ? Math.round((1000 * (totals[f] ?? 0)) / el) / 10
      : null;
  const calls = totals.claim_calls;
  return {
    totals,
    passesWithClaimMs: withClaimMs,
    /** حصصٌ من زمنِ الأشواطِ الجداريّ (%): الالتقاطُ متسلسلٌ فحصّتُه حدٌّ أدنى لزمنِ الحلقة. */
    pctOfPassElapsed: {
      claim: share("claim_ms"),
      lane_full_wait: share("lane_full_wait_ms"),
      saturated_wait: share("saturated_wait_ms"),
      congestion_sleep: share("congestion_sleep_ms"),
    },
    claimMeanMs:
      calls !== undefined && calls > 0 && totals.claim_ms !== undefined
        ? Math.round((100 * totals.claim_ms) / calls) / 100
        : null,
  };
}

/** حصّةُ انتظارِ الطابورِ غيرِ الملتقَطِ التي وقعت بينَ الأشواطِ (لا شوطَ جارٍ). */
export function idleShareOf(
  timelines: readonly RowTimeline[],
  passes: readonly PassWindow[],
  tMs: number,
): number | null {
  if (passes.length === 0) return null;
  // تقريبٌ محافظ: نسبةُ الزمنِ بلا شوطٍ في نافذةِ [أقدمُ إنشاء، T].
  const from = Math.min(...timelines.map((t) => t.createdMs));
  if (!Number.isFinite(from) || from >= tMs) return null;
  const sorted = [...passes].sort((a, b) => a.startMs - b.startMs);
  let covered = 0;
  let cur = from;
  for (const p of sorted) {
    const s = Math.max(p.startMs, cur);
    const e = Math.min(p.endMs, tMs);
    if (e > s) {
      covered += e - s;
      cur = e;
    }
  }
  return Math.round((1000 * (1 - covered / (tMs - from))) / 10) / 100;
}

export interface Decomposition {
  readonly kind: string;
  readonly auditAtMs: number;
  readonly rows: number;
  readonly attemptsSeen: number;
  readonly unmeteredAttempts: number;
  readonly pendingAtAudit: number;
  readonly sendingAtAudit: number;
  readonly auditPending: number | null;
  readonly auditOldestPendingSec: number | null;
  readonly reconstructedOldestPendingSec: number | null;
  readonly validity: { readonly ok: boolean; readonly reasons: readonly string[] };
  readonly oldest: {
    readonly id: string;
    readonly event: string | null;
    readonly attempts: number;
    readonly ageMs: number;
    readonly breakdownMs: Breakdown;
    readonly groupsMs: ReturnType<typeof groupsOf>;
  } | null;
  readonly oldest20: {
    readonly n: number;
    readonly meanAgeMs: number;
    readonly groupsPct: Record<string, number | null>;
  };
  readonly pendingAll: {
    readonly n: number;
    readonly groupsPct: Record<string, number | null>;
    readonly breakdownMs: Breakdown;
    readonly congestionScopes: { chat: number; global: number };
  };
  readonly delivered: {
    readonly n: number;
    readonly latencyMs: { p50: number | null; p95: number | null; max: number | null };
    readonly groupsPct: Record<string, number | null>;
    readonly byOutcome: Record<string, number>;
  };
  readonly drainPasses: {
    readonly n: number;
    readonly idleShareBeforeAudit: number | null;
    readonly stopReasons: Record<string, number>;
    readonly pass: ReturnType<typeof passTotalsOf>;
  };
}

function groupsPctOf(b: Breakdown) {
  const g = groupsOf(b);
  const total = Object.values(g).reduce((x, y) => x + y, 0);
  return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, pct(v, total)]));
}

export function decompose(input: {
  readonly kind: string;
  readonly rows: readonly Row[];
  readonly attempts: readonly Attempt[];
  readonly auditAtMs: number;
  readonly auditPending: number | null;
  readonly auditOldestPendingSec: number | null;
  readonly passes: readonly PassWindow[];
  readonly toleranceSec?: number;
}): { summary: Decomposition; timelines: RowTimeline[] } {
  const tol = input.toleranceSec ?? 2;
  const byId = new Map<string, Attempt[]>();
  for (const a of input.attempts) {
    const l = byId.get(a.deliveryId);
    if (l) l.push(a);
    else byId.set(a.deliveryId, [a]);
  }
  const rows = input.rows.filter((r) => r.kind === input.kind && r.createdMs < input.auditAtMs);
  const timelines = rows.map((r) => timelineOf(r, byId.get(r.id) ?? [], input.auditAtMs));
  // كتعريفِ اللقطة: `status = 'pending'` — المعلّقُ غيرُ الجاري.
  const pending = timelines
    .filter((t) => t.pendingAtT && !t.sendingAtT)
    .sort((a, b) => b.ageMs - a.ageMs);
  const sendingAtAudit = timelines.filter((t) => t.sendingAtT).length;
  const delivered = timelines.filter((t) => !t.pendingAtT);
  const reasons: string[] = [];
  const attemptsSeen = rows.reduce((n, r) => n + (byId.get(r.id)?.length ?? 0), 0);
  const unmetered = timelines.reduce((n, t) => n + t.unmeteredAttempts, 0);
  if (attemptsSeen === 0) reasons.push("no_attempt_trace");
  if (unmetered > 0) reasons.push("unmetered_attempts");
  const recon = pending[0] === undefined ? null : Math.round(pending[0].ageMs / 1000);
  if (input.auditOldestPendingSec !== null && recon !== null) {
    if (Math.abs(recon - input.auditOldestPendingSec) > tol) reasons.push("oldest_mismatch");
  } else if (input.auditOldestPendingSec !== null || recon !== null) {
    reasons.push("oldest_missing");
  }
  if (
    input.auditPending !== null &&
    Math.abs(pending.length - input.auditPending) > Math.max(5, 0.02 * input.auditPending)
  ) {
    reasons.push("pending_count_mismatch");
  }
  const allP = emptyBreakdown();
  const scopes = { chat: 0, global: 0 };
  for (const t of pending) {
    addInto(allP, t.breakdown);
    scopes.chat += t.congestionScopes.chat;
    scopes.global += t.congestionScopes.global;
  }
  const top = pending.slice(0, 20);
  const topB = emptyBreakdown();
  for (const t of top) addInto(topB, t.breakdown);
  const delB = emptyBreakdown();
  const byOutcome: Record<string, number> = {};
  for (const t of delivered) {
    addInto(delB, t.breakdown);
    const k =
      t.terminalOutcome === "external"
        ? `external:${t.settledVia ?? "unknown"}`
        : (t.terminalOutcome ?? "none");
    byOutcome[k] = (byOutcome[k] ?? 0) + 1;
  }
  const lat = delivered.map((t) => t.ageMs).sort((a, b) => a - b);
  const passes = input.passes.filter((p) => p.endMs <= input.auditAtMs + 10_000);
  const stopReasons: Record<string, number> = {};
  for (const p of passes) stopReasons[p.stop ?? "none"] = (stopReasons[p.stop ?? "none"] ?? 0) + 1;
  const o = pending[0];
  return {
    summary: {
      kind: input.kind,
      auditAtMs: input.auditAtMs,
      rows: rows.length,
      attemptsSeen,
      unmeteredAttempts: unmetered,
      pendingAtAudit: pending.length,
      sendingAtAudit,
      auditPending: input.auditPending,
      auditOldestPendingSec: input.auditOldestPendingSec,
      reconstructedOldestPendingSec: recon,
      validity: { ok: reasons.length === 0, reasons },
      oldest:
        o === undefined
          ? null
          : {
              id: o.id,
              event: o.event,
              attempts: o.attempts,
              ageMs: o.ageMs,
              breakdownMs: o.breakdown,
              groupsMs: groupsOf(o.breakdown),
            },
      oldest20: {
        n: top.length,
        meanAgeMs:
          top.length === 0 ? 0 : Math.round(top.reduce((x, t) => x + t.ageMs, 0) / top.length),
        groupsPct: groupsPctOf(topB),
      },
      pendingAll: {
        n: pending.length,
        groupsPct: groupsPctOf(allP),
        breakdownMs: allP,
        congestionScopes: scopes,
      },
      delivered: {
        n: delivered.length,
        latencyMs: { p50: quantile(lat, 0.5), p95: quantile(lat, 0.95), max: lat.at(-1) ?? null },
        groupsPct: groupsPctOf(delB),
        byOutcome,
      },
      drainPasses: {
        n: passes.length,
        idleShareBeforeAudit: idleShareOf(timelines, passes, input.auditAtMs),
        stopReasons,
        pass: passTotalsOf(passes),
      },
    },
    timelines,
  };
}

// ——— قراءةُ المدخلات ———

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** أسطرُ `notification.attempt` و`job.ran` لـ`deliver-notifications` من سجلِّ البوّابة/العامل. */
export function parseLog(text: string): {
  attempts: Attempt[];
  passes: PassWindow[];
  riderEvents: Record<string, number>;
} {
  const attempts: Attempt[] = [];
  const passes: PassWindow[] = [];
  /** عدُّ أحداثِ `rider_trip_notice.*` القائمةِ أصلًا، وسببُ الرجوعِ إلى تيليجرامَ مفصولًا. */
  const riderEvents: Record<string, number> = {};
  for (const line of text.split("\n")) {
    if (
      !line.includes("notification.attempt") &&
      !line.includes("deliver-notifications") &&
      !line.includes("rider_trip_notice.")
    )
      continue;
    const at = line.indexOf("{");
    if (at < 0) continue;
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(line.slice(at)) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (
      r.event === "notification.attempt" &&
      typeof r.delivery_id === "string" &&
      UUID.test(r.delivery_id)
    ) {
      const scope =
        r.congestion_scope === "chat" || r.congestion_scope === "global"
          ? r.congestion_scope
          : null;
      attempts.push({
        deliveryId: r.delivery_id,
        startedAtMs: num(r.started_at_ms),
        durationMs: num(r.duration_ms),
        laneWaitMs: typeof r.lane_wait_ms === "number" ? r.lane_wait_ms : null,
        outcome: String(r.outcome) as Outcome,
        retryAfterMs: typeof r.retry_after_ms === "number" ? r.retry_after_ms : null,
        metered: r.metered === 1,
        acquireMs: num(r.acquire_ms),
        chatWaitMs: num(r.chat_wait_ms),
        globalWaitMs: num(r.global_wait_ms),
        congestionScope: scope,
        apiMs: num(r.api_ms),
        throttleWaitMs: num(r.throttle_wait_ms),
        retryWaitMs: num(r.retry_wait_ms),
      });
    } else if (typeof r.event === "string" && r.event.startsWith("rider_trip_notice.")) {
      const reason =
        typeof r.reason === "string" && /^[a-z_]{1,32}$/.test(r.reason) ? `:${r.reason}` : "";
      const k = `${r.event}${reason}`;
      riderEvents[k] = (riderEvents[k] ?? 0) + 1;
    } else if (
      r.event === "job.ran" &&
      r.job === "deliver-notifications" &&
      typeof r.at === "string"
    ) {
      const end = Date.parse(r.at);
      const dur = num(r.durationMs);
      const m = typeof r.detail === "string" ? /stop=(\w+)/.exec(r.detail) : null;
      const fields: Record<string, number> = {};
      if (typeof r.detail === "string") {
        for (const f of PASS_FIELDS) {
          const x = new RegExp(`(?:^| )${f}=(\\d+)(?= |$)`).exec(r.detail);
          if (x?.[1] !== undefined) fields[f] = Number(x[1]);
        }
      }
      if (Number.isFinite(end))
        passes.push({ startMs: end - dur, endMs: end, stop: m?.[1] ?? null, fields });
    }
  }
  return { attempts, passes, riderEvents };
}

/**
 * `notice-rows.csv` بترويسة: id,kind,event,created_ms[,settled_ms,settled_via] (من `db-export.sh`).
 * العمودانِ الأخيرانِ اختياريّان (التوافقُ معَ تصديرٍ أقدم).
 */
export function parseRows(csv: string): Row[] {
  const lines = csv.split("\n").filter((l) => l.trim() !== "");
  const head = (lines.shift() ?? "").split(",");
  const ix = (n: string) => head.indexOf(n);
  const [iId, iKind, iEv, iC] = [ix("id"), ix("kind"), ix("event"), ix("created_ms")];
  if ([iId, iKind, iEv, iC].some((i) => i < 0)) throw new Error("ترويسةُ notice-rows.csv ناقصة");
  const [iS, iV] = [ix("settled_ms"), ix("settled_via")];
  const out: Row[] = [];
  for (const l of lines) {
    const c = l.split(",");
    const id = c[iId] ?? "";
    const created = Number(c[iC]);
    if (!UUID.test(id) || !Number.isFinite(created)) continue;
    const ev = c[iEv] ?? "";
    const sRaw = iS < 0 ? "" : (c[iS] ?? "");
    const settled = sRaw === "" ? null : Number(sRaw);
    const via = iV < 0 ? "" : (c[iV] ?? "");
    out.push({
      id,
      kind: c[iKind] ?? "",
      event: /^[A-Z][A-Z0-9_]{0,31}$/.test(ev) ? ev : null,
      createdMs: created,
      settledMs: settled !== null && Number.isFinite(settled) ? settled : null,
      settledVia: /^[a-z_]{1,32}$/.test(via) ? via : null,
    });
  }
  return out;
}

export function auditOf(json: string, kind: string) {
  const a = JSON.parse(json) as {
    snapshot: {
      at: string;
      outbox: {
        byKind?: Record<string, { pending?: number }>;
        pendingAgeByKind?: Record<string, { pending?: number; oldestPendingSec?: number | null }>;
      };
    };
  };
  const pa = a.snapshot.outbox.pendingAgeByKind?.[kind];
  return {
    atMs: Date.parse(a.snapshot.at),
    pending: pa?.pending ?? a.snapshot.outbox.byKind?.[kind]?.pending ?? null,
    oldestPendingSec: pa?.oldestPendingSec ?? null,
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

if (import.meta.main) {
  const log = arg("--log");
  const rowsPath = arg("--rows");
  const auditPath = arg("--audit");
  const out = arg("--out");
  const kind = arg("--kind") ?? "rider_trip_notice";
  if (!log || !rowsPath || !auditPath || !out) {
    console.error(
      "usage: notice-decompose.ts --log <f> --rows <csv> --audit <json> --out <dir> [--kind k]",
    );
    process.exit(2);
  }
  const audit = auditOf(readFileSync(auditPath, "utf8"), kind);
  const { attempts, passes, riderEvents } = parseLog(readFileSync(log, "utf8"));
  const { summary, timelines } = decompose({
    kind,
    rows: parseRows(readFileSync(rowsPath, "utf8")),
    attempts,
    auditAtMs: audit.atMs,
    auditPending: audit.pending,
    auditOldestPendingSec: audit.oldestPendingSec,
    passes,
  });
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, "notice-decompose.json"),
    `${JSON.stringify({ ...summary, riderTripLogEvents: riderEvents }, null, 2)}\n`,
  );
  const pend = timelines.filter((t) => t.pendingAtT);
  const done = timelines.filter((t) => !t.pendingAtT);
  const sample = done.filter((_, i) => i % Math.max(1, Math.floor(done.length / 500)) === 0);
  writeFileSync(
    join(out, "notice-trace.jsonl"),
    `${[...pend, ...sample].map((t) => JSON.stringify(t)).join("\n")}\n`,
  );
  console.log(
    `NOTICE_DECOMPOSE kind=${kind} rows=${summary.rows} attempts=${summary.attemptsSeen} pending=${summary.pendingAtAudit}/${summary.auditPending} oldest=${summary.reconstructedOldestPendingSec}/${summary.auditOldestPendingSec} valid=${summary.validity.ok ? "ok" : summary.validity.reasons.join("+")}`,
  );
}
