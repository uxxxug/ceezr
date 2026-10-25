#!/usr/bin/env bun
/**
 * LOAD-01M · الدورةُ الرابعة — الخطُّ الزمنيُّ الفعليُّ لكلِّ وظيفةِ تحديثٍ في الكنّاس، مفصولًا بنوعِ
 * الوظيفة (contact · command · message · callback · other)، معَ التأخّرِ والمهلِ والعدالة، وانتظارِ مجمّعِ
 * gatewayRequest وأثرِه في المساراتِ الأخرى. أداةُ قياسٍ لا تمسُّ سلوكَ المنتج ولا حدودَه.
 *
 * الاستعمال:
 *   bun deploy/capacity-run/monitor/job-timeline.ts <raw-dir> [<raw-dir> ...]          (تقريرٌ لكلِّ موجة)
 *   bun deploy/capacity-run/monitor/job-timeline.ts --paired A1:<raw> B1:<raw> ...      (مقارنةٌ مقترنة)
 *
 * المدخلاتُ لكلِّ موجة:
 *   update-jobs.csv(.gz)   bot,update_id,created_ms,done_ms,status,attempts[,kind] (بلا ترويسة)
 *   load-trace.jsonl(.gz)  k=job (+claimTripMs/claimBatch/claimPos) · k=reply · k=db · k=pdb
 *   mixed-sent.jsonl       (اختياريّ) ما أرسلَه مولّدُ الحِملِ المختلط (load/mixed-telegram.ts)
 *
 * الأطوارُ لكلِّ وظيفة (المرجعُ ساعةُ الجدارِ نفسُها في البوّابةِ والقاعدةِ على المقعدِ الواحد):
 *   queue    = claimedAt − created_ms                 الانتظارُ قبلَ الالتقاط
 *   claim    = claimTripMs                            مدّةُ رحلةِ الالتقاطِ التي جلبَتها (claimMs الفعليّ)
 *   lane     = startedAt − claimedAt                  انتظارُ مسارِ المستخدم
 *   exec     = endedAt − startedAt                    المعالجة (منها gateWaitMs: انتظارُ مقعدِ gatewayRequest)
 *   finish   = endedAt − created_ms                   حتّى ختمِ الأثر (الوظيفةُ done)
 *   sendWait = reply.startedAt − reply.submittedAt    انتظارُ المُرسِلِ الفوريّ
 *   send     = reply.endedAt − reply.startedAt        الإرسالُ وختمُ الدفتر (يشملُ دلوَ البوت)
 *   reply    = آخرُ reply.endedAt ناجح − created_ms   حتّى وصولِ الردِّ (بما فيه المؤجَّلُ للخلفيّ)
 *
 * التأخّرُ يُقاسُ على مهلةٍ مرجعيّة (`LATENESS_REF_MS`، افتراضًا 20000 = مهلةُ إثباتِ الرقمِ في المولّد
 * PHONE_PROOF_WAIT_MS) لكلِّ الأنواعِ للمقارنةِ وحدَها — **ليست بوّابةً جديدةً ولا عتبة**.
 * العدالة: مؤشّرُ Jain على متوسّطاتِ الانتظارِ لكلِّ نوع (1 = تساوٍ تامّ)، ونسبةُ وسيطِ كلِّ نوعٍ إلى
 * الوسيطِ العامّ، وأقصى انتظارٍ لكلِّ نوع. أولويّةُ contact تُخِلُّ بالتساوي **عمدًا**؛ فالمؤشّرُ وصفٌ لا حكم.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { parseCsv, parseG1, parseValid, type Summary, summarise } from "./drainer-decompose.ts";

/** المقاعدُ المحميّةُ لمجمّعِ gatewayRequest (قراءةٌ للحسابِ وحدَه؛ لا تُغيَّر هنا). */
export const GATEWAY_REQUEST_SEATS = 5;
export const LATENESS_REF_MS = 20_000;
export const KINDS = ["contact", "command", "message", "callback", "other", "unknown"] as const;

export interface JobRow {
  readonly key: string;
  readonly bot: string;
  readonly updateId: number;
  readonly createdMs: number;
  readonly doneMs: number | null;
  readonly status: string;
  readonly attempts: number;
  readonly kind: string | null;
}

/** update-jobs.csv: العمودُ السابعُ (kind) اختياريّ — العُددُ السابقةُ بلا نوع. */
export function parseJobs(csv: string): JobRow[] {
  const out: JobRow[] = [];
  for (const r of parseCsv(csv)) {
    if (r.length < 6) continue;
    const created = Number(r[2]);
    if (!Number.isFinite(created) || r[2] === "") continue;
    const done = r[3] === "" || r[3] === undefined ? null : Number(r[3]);
    out.push({
      key: `${r[0]}:${r[1]}`,
      bot: r[0] as string,
      updateId: Number(r[1]),
      createdMs: created,
      doneMs: done !== null && Number.isFinite(done) ? done : null,
      status: r[4] as string,
      attempts: Number(r[5]),
      kind: r[6] === undefined || r[6] === "" ? null : (r[6] as string),
    });
  }
  return out;
}

export interface TJob {
  readonly bot: string;
  readonly updateId: number;
  readonly kind?: string;
  readonly claimedAt?: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly ok: boolean;
  readonly gateWaitMs?: number;
  readonly claimTripMs?: number;
  readonly claimBatch?: number;
}

export interface TReply {
  readonly bot: string;
  readonly updateId: number;
  readonly path: "pool" | "inline" | "overflow" | "background";
  readonly submittedAt: number;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly sent: number;
  readonly total: number;
  readonly outcome: string | null;
  readonly error: boolean;
}

export interface TDb {
  readonly at: number;
  readonly pool: string;
  readonly kind: string;
  readonly n: number;
  readonly waitSumMs: number;
  readonly runSumMs: number;
  readonly waitP95Ms?: number;
}

export interface TPdb extends TDb {
  readonly path: string;
  readonly waitMaxMs?: number;
}

export interface Trace {
  readonly jobs: TJob[];
  readonly replies: TReply[];
  readonly db: TDb[];
  readonly pdb: TPdb[];
}

export function parseTrace(jsonl: string): Trace {
  const t: Trace = { jobs: [], replies: [], db: [], pdb: [] };
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (o.k === "job") t.jobs.push(o as unknown as TJob);
    else if (o.k === "reply") t.replies.push(o as unknown as TReply);
    else if (o.k === "db") t.db.push(o as unknown as TDb);
    else if (o.k === "pdb") t.pdb.push(o as unknown as TPdb);
  }
  return t;
}

export interface Timeline {
  readonly key: string;
  readonly kind: string;
  readonly status: string;
  readonly attempts: number;
  readonly createdMs: number;
  readonly queueMs: number | null;
  readonly claimMs: number | null;
  readonly laneMs: number | null;
  readonly execMs: number | null;
  readonly gateWaitMs: number | null;
  readonly finishMs: number | null;
  readonly sendWaitMs: number | null;
  readonly sendMs: number | null;
  readonly replyMs: number | null;
  readonly replyPath: string | null;
  readonly overflowed: boolean;
}

/**
 * الربطُ بالمفتاح bot:update_id. أوّلُ سطرِ job ناجحٍ هو المعتمَد (المحاولاتُ المُعادةُ تبقى في attempts).
 * الردُّ: أوّلُ إرسالٍ بدأ (pool/inline) لزمنِ الانتظارِ والإرسال، وآخرُ ختمٍ `done` لزمنِ وصولِ الرد.
 */
export function buildTimelines(rows: readonly JobRow[], trace: Trace): Timeline[] {
  const jobs = new Map<string, TJob>();
  for (const j of trace.jobs) {
    const k = `${j.bot}:${j.updateId}`;
    const prev = jobs.get(k);
    if (prev === undefined || (!prev.ok && j.ok)) jobs.set(k, j);
  }
  const replies = new Map<string, TReply[]>();
  for (const r of trace.replies) {
    const k = `${r.bot}:${r.updateId}`;
    replies.set(k, [...(replies.get(k) ?? []), r]);
  }
  return rows.map((row) => {
    const j = jobs.get(row.key);
    const rs = replies.get(row.key) ?? [];
    const firstSend = rs.find((r) => r.startedAt !== null && r.path !== "background");
    const delivered = rs.filter((r) => r.outcome === "done" && r.endedAt !== null);
    const lastDone = delivered.length === 0 ? null : delivered[delivered.length - 1];
    const claimedAt = j?.claimedAt ?? null;
    const sub = (a: number | null | undefined, b: number | null | undefined): number | null =>
      a === null || a === undefined || b === null || b === undefined ? null : a - b;
    return {
      key: row.key,
      kind: row.kind ?? j?.kind ?? "unknown",
      status: row.status,
      attempts: row.attempts,
      createdMs: row.createdMs,
      queueMs: sub(claimedAt, row.createdMs),
      claimMs: j?.claimTripMs ?? null,
      laneMs: sub(j?.startedAt, claimedAt),
      execMs: sub(j?.endedAt, j?.startedAt),
      gateWaitMs: j?.gateWaitMs ?? null,
      finishMs: sub(j?.endedAt, row.createdMs),
      sendWaitMs: sub(firstSend?.startedAt, firstSend?.submittedAt),
      sendMs: sub(firstSend?.endedAt, firstSend?.startedAt),
      replyMs: sub(lastDone?.endedAt, row.createdMs),
      replyPath: lastDone?.path ?? (rs.length > 0 ? (rs[rs.length - 1] as TReply).path : null),
      overflowed: rs.some((r) => r.path === "overflow"),
    };
  });
}

export interface KindReport {
  readonly kind: string;
  readonly n: number;
  readonly status: Record<string, number>;
  /** وظائفُ لم يظهرْ لها سطرُ job في الأثر (لم تُلتقَط أو أثرٌ ناقص). */
  readonly untraced: number;
  readonly queue: Summary;
  readonly claim: Summary;
  readonly lane: Summary;
  readonly exec: Summary;
  readonly gateWait: Summary;
  readonly finish: Summary;
  readonly sendWait: Summary;
  readonly send: Summary;
  readonly reply: Summary;
  readonly replyPaths: Record<string, number>;
  readonly overflowed: number;
  readonly late: {
    readonly refMs: number;
    /** finish > ref أو لم تُختَم (done) أبدًا. */
    readonly lateFinish: number;
    readonly lateFinishPct: number | null;
    /** مقدارُ التجاوزِ (finish − ref) للمتأخّرةِ المختومة. */
    readonly overBy: Summary;
  };
  /** «مهلة» = لم تبلغْ done عندَ التصدير (pending/processing/dead). */
  readonly notDone: number;
  readonly maxQueueMs: number | null;
}

function vals(xs: readonly Timeline[], f: (t: Timeline) => number | null): number[] {
  const out: number[] = [];
  for (const t of xs) {
    const v = f(t);
    if (v !== null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

export function kindReport(
  kind: string,
  xs: readonly Timeline[],
  refMs = LATENESS_REF_MS,
): KindReport {
  const status: Record<string, number> = {};
  const paths: Record<string, number> = {};
  for (const t of xs) {
    status[t.status] = (status[t.status] ?? 0) + 1;
    if (t.replyPath !== null) paths[t.replyPath] = (paths[t.replyPath] ?? 0) + 1;
  }
  const notDone = xs.filter((t) => t.status !== "done").length;
  const lateDone = xs.filter(
    (t) => t.status === "done" && t.finishMs !== null && t.finishMs > refMs,
  );
  const lateFinish = lateDone.length + notDone;
  const queue = vals(xs, (t) => t.queueMs);
  return {
    kind,
    n: xs.length,
    status,
    untraced: xs.filter((t) => t.execMs === null).length,
    queue: summarise(queue),
    claim: summarise(vals(xs, (t) => t.claimMs)),
    lane: summarise(vals(xs, (t) => t.laneMs)),
    exec: summarise(vals(xs, (t) => t.execMs)),
    gateWait: summarise(vals(xs, (t) => t.gateWaitMs)),
    finish: summarise(vals(xs, (t) => t.finishMs)),
    sendWait: summarise(vals(xs, (t) => t.sendWaitMs)),
    send: summarise(vals(xs, (t) => t.sendMs)),
    reply: summarise(vals(xs, (t) => t.replyMs)),
    replyPaths: paths,
    overflowed: xs.filter((t) => t.overflowed).length,
    late: {
      refMs,
      lateFinish,
      lateFinishPct: xs.length === 0 ? null : Math.round((lateFinish / xs.length) * 10000) / 100,
      overBy: summarise(lateDone.map((t) => (t.finishMs as number) - refMs)),
    },
    notDone,
    maxQueueMs: queue.length === 0 ? null : Math.max(...queue),
  };
}

/** مؤشّرُ Jain: (Σx)² / (n·Σx²) — 1 = تساوٍ، و1/n = أقصى تفاوت. null إن قلَّت العناصرُ عن اثنين. */
export function jain(xs: readonly number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x) && x >= 0);
  if (v.length < 2) return null;
  const s = v.reduce((a, b) => a + b, 0);
  const s2 = v.reduce((a, b) => a + b * b, 0);
  if (s2 === 0) return 1;
  return Math.round(((s * s) / (v.length * s2)) * 10000) / 10000;
}

export interface Fairness {
  /** على متوسّطِ الانتظارِ قبلَ الالتقاطِ لكلِّ نوعٍ فيه ≥ minN وظيفة. */
  readonly jainQueueMean: number | null;
  readonly jainFinishMean: number | null;
  /** وسيطُ انتظارِ النوعِ ÷ الوسيطِ العامّ. */
  readonly queueP50Ratio: Record<string, number | null>;
  readonly kindsCounted: string[];
}

export function fairness(reports: readonly KindReport[], all: KindReport, minN = 30): Fairness {
  const counted = reports.filter((r) => r.queue.n >= minN);
  const ratio: Record<string, number | null> = {};
  for (const r of counted)
    ratio[r.kind] =
      r.queue.p50 === null || all.queue.p50 === null || all.queue.p50 === 0
        ? null
        : Math.round((r.queue.p50 / all.queue.p50) * 1000) / 1000;
  return {
    jainQueueMean: jain(counted.map((r) => r.queue.mean as number)),
    jainFinishMean: jain(counted.map((r) => r.finish.mean as number)),
    queueP50Ratio: ratio,
    kindsCounted: counted.map((r) => r.kind),
  };
}

export interface PoolWait {
  readonly pool: string;
  readonly seats: number;
  readonly windows: number;
  readonly windowMs: number | null;
  /** إشغالُ المقاعد = Σ زمنِ الاحتجاز ÷ (نافذة × المقاعد). */
  readonly occupancy: Summary;
  /** نوافذُ إشغالُها ≥ 0.9 (المجمّعُ قريبٌ من التشبّع). */
  readonly saturatedWindows: number;
  readonly waitMsPerCall: Summary;
  readonly totalWaitS: number;
  readonly totalHoldS: number;
  /** لكلِّ مسار: النداءات، ومجموعُ الانتظار، ومتوسّطُه لكلِّ نداء، وأقصى p95 نافذة. */
  readonly byPath: {
    path: string;
    n: number;
    waitS: number;
    waitMsPerCall: number;
    holdS: number;
    maxWindowP95Ms: number;
    drainer: boolean;
  }[];
  /** نصيبُ مساراتِ الكنّاس من مجموعِ الانتظار (البقيّةُ HTTP وخلفيّاتٌ أخرى). */
  readonly drainerWaitShare: number | null;
}

export function poolWait(
  trace: Trace,
  pool = "ceezr:gatewayRequest",
  seats = GATEWAY_REQUEST_SEATS,
): PoolWait {
  const rows = trace.db.filter((d) => d.pool === pool).sort((a, b) => a.at - b.at);
  // النافذةُ = الفرقُ الوسيطُ بينَ عيّناتٍ متتالية (load-trace يكتبُ كلَّ 5 ثوانٍ).
  const ats = [...new Set(rows.map((r) => r.at))].sort((a, b) => a - b);
  const gaps = ats.slice(1).map((a, i) => a - (ats[i] as number));
  const windowMs = gaps.length === 0 ? null : summarise(gaps).p50;
  const perWindow = new Map<number, { wait: number; run: number; n: number }>();
  for (const r of rows) {
    const w = perWindow.get(r.at) ?? { wait: 0, run: 0, n: 0 };
    w.wait += r.waitSumMs;
    w.run += r.runSumMs;
    w.n += r.n;
    perWindow.set(r.at, w);
  }
  const occ =
    windowMs === null || windowMs === 0
      ? []
      : [...perWindow.values()].map((w) => w.run / (windowMs * seats));
  const perCall = [...perWindow.values()].filter((w) => w.n > 0).map((w) => w.wait / w.n);
  const byPathMap = new Map<string, { n: number; wait: number; run: number; p95: number }>();
  for (const p of trace.pdb.filter((x) => x.pool === pool)) {
    const e = byPathMap.get(p.path) ?? { n: 0, wait: 0, run: 0, p95: 0 };
    e.n += p.n;
    e.wait += p.waitSumMs;
    e.run += p.runSumMs;
    e.p95 = Math.max(e.p95, p.waitP95Ms ?? 0);
    byPathMap.set(p.path, e);
  }
  const r2 = (x: number): number => Math.round(x * 100) / 100;
  const byPath = [...byPathMap.entries()]
    .map(([path, e]) => ({
      path,
      n: e.n,
      waitS: r2(e.wait / 1000),
      waitMsPerCall: e.n === 0 ? 0 : r2(e.wait / e.n),
      holdS: r2(e.run / 1000),
      maxWindowP95Ms: r2(e.p95),
      drainer: path.startsWith("drainer:"),
    }))
    .sort((a, b) => b.waitS - a.waitS);
  const totalPathWait = byPath.reduce((a, p) => a + p.waitS, 0);
  const drainerWait = byPath.filter((p) => p.drainer).reduce((a, p) => a + p.waitS, 0);
  return {
    pool,
    seats,
    windows: perWindow.size,
    windowMs,
    occupancy: summarise(occ.map((x) => Math.round(x * 1000) / 1000)),
    saturatedWindows: occ.filter((x) => x >= 0.9).length,
    waitMsPerCall: summarise(perCall),
    totalWaitS: r2(rows.reduce((a, r) => a + r.waitSumMs, 0) / 1000),
    totalHoldS: r2(rows.reduce((a, r) => a + r.runSumMs, 0) / 1000),
    byPath,
    drainerWaitShare:
      totalPathWait === 0 ? null : Math.round((drainerWait / totalPathWait) * 1000) / 1000,
  };
}

export interface MixedSent {
  readonly kind: string;
  readonly plannedAt: number;
  readonly sentAt: number;
  readonly status: number;
}

export interface MixedCheck {
  readonly planned: number;
  readonly sent: number;
  readonly ok2xx: number;
  readonly byKind: Record<string, number>;
  /** تأخّرُ المولّدِ عن جدولِه (sentAt − plannedAt). */
  readonly scheduleLag: Summary;
  readonly skipped: number;
}

export function parseMixed(jsonl: string | null): MixedCheck | null {
  if (jsonl === null) return null;
  const sent: MixedSent[] = [];
  let skipped = 0;
  let planned = 0;
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    const o = JSON.parse(line) as Record<string, unknown>;
    if (o.k === "sent") sent.push(o as unknown as MixedSent);
    else if (o.k === "skipped") skipped += 1;
    else if (o.k === "plan") planned = Number(o.n);
  }
  const byKind: Record<string, number> = {};
  for (const s of sent) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  return {
    planned,
    sent: sent.length,
    ok2xx: sent.filter((s) => s.status >= 200 && s.status < 300).length,
    byKind,
    scheduleLag: summarise(sent.map((s) => s.sentAt - s.plannedAt)),
    skipped,
  };
}

function readMaybe(path: string): string | null {
  for (const p of [path, `${path}.gz`]) {
    if (!existsSync(p)) continue;
    const buf = readFileSync(p);
    return p.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  }
  return null;
}

export function analyseTimeline(raw: string, refMs = LATENESS_REF_MS) {
  const rows = parseJobs(readMaybe(join(raw, "update-jobs.csv")) ?? "");
  const trace = parseTrace(readMaybe(join(raw, "load-trace.jsonl")) ?? "");
  const tl = buildTimelines(rows, trace);
  const kinds = [...new Set(tl.map((t) => t.kind))].sort(
    (a, b) => KINDS.indexOf(a as never) - KINDS.indexOf(b as never),
  );
  const byKind = kinds.map((k) =>
    kindReport(
      k,
      tl.filter((t) => t.kind === k),
      refMs,
    ),
  );
  const all = kindReport("all", tl, refMs);
  const nonContact = kindReport(
    "non-contact",
    tl.filter((t) => t.kind !== "contact" && t.kind !== "unknown"),
    refMs,
  );
  return {
    raw,
    instrumented: {
      kindColumn: rows.some((r) => r.kind !== null),
      claimTrip: trace.jobs.some((j) => j.claimTripMs !== undefined),
      replies: trace.replies.length > 0,
    },
    all,
    nonContact,
    byKind,
    fairness: fairness(byKind, all),
    pool: poolWait(trace),
    mixed: parseMixed(readMaybe(join(raw, "mixed-sent.jsonl"))),
    g1: parseG1(readMaybe(join(raw, "wave-report.json"))),
    valid: parseValid(readMaybe(join(raw, "validity.json"))),
  };
}

export type WaveTimeline = ReturnType<typeof analyseTimeline>;

/**
 * مقارنةُ الآليّةِ المقترنة (مسجَّلةٌ مسبقًا في PROTOCOL-load01m-mixed.md): لكلِّ زوجٍ i نسبةُ وسيطِ
 * انتظارِ contact في B إلى A، ونسبةُ وسيطِ انتظارِ غيرِ contact. الاتّجاهُ يُعلَنُ إن اتّفقَت إشارةُ
 * log(النسبة) في ≥ 3 أزواجٍ من 4 وكانَ وسيطُ النسبِ خارجَ [0.9, 1.1]؛ وإلّا «غيرُ محسوم».
 * هذا وصفٌ للآليّة؛ الحكمُ على G1 يبقى بقاعدةِ AB_RULE في drainer-decompose.ts.
 */
export const MECH_RULE = { minAgree: 3, band: [0.9, 1.1] as const };

export function mechanismPairs(
  pairs: readonly { a: WaveTimeline; b: WaveTimeline }[],
  pick: (w: WaveTimeline) => number | null,
): {
  ratios: (number | null)[];
  median: number | null;
  direction: "B_LOWER" | "B_HIGHER" | "UNDECIDED";
} {
  const ratios = pairs.map(({ a, b }) => {
    const x = pick(a);
    const y = pick(b);
    return x === null || y === null || x === 0 ? null : Math.round((y / x) * 1000) / 1000;
  });
  const v = ratios.filter((r): r is number => r !== null);
  const med = v.length === 0 ? null : summarise(v).p50;
  const lower = v.filter((r) => r < 1).length;
  const higher = v.filter((r) => r > 1).length;
  let direction: "B_LOWER" | "B_HIGHER" | "UNDECIDED" = "UNDECIDED";
  if (med !== null && lower >= MECH_RULE.minAgree && med < MECH_RULE.band[0]) direction = "B_LOWER";
  if (med !== null && higher >= MECH_RULE.minAgree && med > MECH_RULE.band[1])
    direction = "B_HIGHER";
  return { ratios, median: med, direction };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === "--paired") {
    const slots = new Map<string, string>();
    for (const a of args.slice(1)) {
      const m = /^([AB][1-9]):(.+)$/.exec(a);
      if (m === null) throw new Error(`خانةٌ غيرُ مفهومة: ${a}`);
      slots.set(m[1] as string, m[2] as string);
    }
    const waves = new Map([...slots].map(([k, d]) => [k, analyseTimeline(d)]));
    const pairs: { a: WaveTimeline; b: WaveTimeline }[] = [];
    for (let i = 1; i <= 9; i++) {
      const a = waves.get(`A${i}`);
      const b = waves.get(`B${i}`);
      if (a !== undefined && b !== undefined && a.valid !== false && b.valid !== false)
        pairs.push({ a, b });
    }
    const contact = (w: WaveTimeline) => w.byKind.find((k) => k.kind === "contact");
    console.log(
      JSON.stringify(
        {
          rule: MECH_RULE,
          pairs: pairs.length,
          contactQueueP50: mechanismPairs(pairs, (w) => contact(w)?.queue.p50 ?? null),
          nonContactQueueP50: mechanismPairs(pairs, (w) => w.nonContact.queue.p50),
          contactFinishP50: mechanismPairs(pairs, (w) => contact(w)?.finish.p50 ?? null),
          nonContactFinishP50: mechanismPairs(pairs, (w) => w.nonContact.finish.p50),
          waves: Object.fromEntries(
            [...waves].map(([k, w]) => [
              k,
              {
                g1: w.g1,
                valid: w.valid,
                byKind: w.byKind.map((r) => ({
                  kind: r.kind,
                  n: r.n,
                  notDone: r.notDone,
                  queueP50: r.queue.p50,
                  finishP50: r.finish.p50,
                  replyP50: r.reply.p50,
                  latePct: r.late.lateFinishPct,
                })),
                fairness: w.fairness,
                pool: {
                  occupancyP50: w.pool.occupancy.p50,
                  saturatedWindows: w.pool.saturatedWindows,
                  windows: w.pool.windows,
                  drainerWaitShare: w.pool.drainerWaitShare,
                },
                mixed: w.mixed,
              },
            ]),
          ),
        },
        null,
        2,
      ),
    );
  } else {
    for (const raw of args) console.log(JSON.stringify(analyseTimeline(raw), null, 2));
  }
}
