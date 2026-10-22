/**
 * LOAD-01 — نسبةُ P7/G4 إلى مصدرِها (رصدٌ لا بوابة).
 *
 * P7 («أقدمُ مهمّةِ إشعارٍ معلّقةٍ عندَ التدقيق ≤ 120ث») وقاعدةُ G4 `stale_pending_outbox`
 * يقرآنِ **المُدخلَ نفسَه** (`outbox.oldestPendingSec`)؛ فهما عرَضٌ واحدٌ يُحسَبُ مرّتين.
 * أدلّةُ Batch32 لا تقولُ أيُّ نوعٍ هو الأقدم، ولا هل بلغَ بوتُ الراكبِ سقفَهُ (25/ث) أثناءَ
 * التراكم، لأنَّ سجلَّ المحاكي لم يُؤرشَف (التحليلُ في
 * `docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/BATCH-33-READINESS-20261022.md`).
 *
 * هذه الوحدةُ تحسبُ — من مدخلاتٍ موجودةٍ أصلًا وبلا أيِّ حملٍ إضافيٍّ على المسارِ المقيس —
 * ما يلزمُ لحسمِ ذلك في الموجةِ القادمة:
 * - عمرُ أقدمِ صفٍّ معلّقٍ **لكلِّ نوع** (`pendingAgeByKind`)؛
 * - خطُّ زمنِ القبولِ (200) لكلِّ بوتٍ بالثانية، وذروتُه، ومعدّلُه في الثواني المشغولة
 *   (`summarizeEgressTimeline`).
 *
 * لا تغييرَ في عتبةٍ ولا في قاعدةٍ ولا في تعريفِ المستخدمِ المتزامن: الحكمُ يبقى كما هو.
 */

export interface PendingAgeRow {
  readonly kind: string;
  readonly n: string | number;
  /** ثوانٍ (نصٌّ من Postgres أو رقم)؛ `null` إن لم يوجد معلّق. */
  readonly oldest: string | number | null;
}

export interface PendingAgeByKind {
  readonly [kind: string]: { readonly pending: number; readonly oldestPendingSec: number | null };
}

export function pendingAgeByKind(rows: readonly PendingAgeRow[]): PendingAgeByKind {
  const out: Record<string, { pending: number; oldestPendingSec: number | null }> = {};
  for (const r of rows) {
    const age = r.oldest === null ? null : Number(r.oldest);
    out[r.kind] = {
      pending: Number(r.n),
      oldestPendingSec: age === null || !Number.isFinite(age) ? null : Math.round(age),
    };
  }
  return out;
}

/** النوعُ صاحبُ أقدمِ معلّقٍ (أو `null` إن لا معلّق) — ما يُفسِّرُ قيمةَ P7. */
export function oldestPendingKind(byKind: PendingAgeByKind): string | null {
  let best: { kind: string; age: number } | null = null;
  for (const [kind, v] of Object.entries(byKind)) {
    if (v.oldestPendingSec === null) continue;
    if (best === null || v.oldestPendingSec > best.age) best = { kind, age: v.oldestPendingSec };
  }
  return best?.kind ?? null;
}

export interface EgressTimelineBot {
  readonly accepted: number;
  readonly rejected: number;
  /** أوّلُ وآخرُ ثانيةِ قبولٍ (ms منذ epoch، مقرَّبةٌ لأسفلَ إلى الثانية). */
  readonly firstAcceptedSecMs: number | null;
  readonly lastAcceptedSecMs: number | null;
  /** عددُ الثواني التي فيها قبولٌ واحدٌ على الأقل. */
  readonly busySeconds: number;
  /** أعلى قبولٍ في ثانيةٍ واحدة. */
  readonly peakPerSec: number;
  /** القبولُ ÷ الثواني المشغولة — المعدّلُ الفعليُّ أثناءَ الإرسال. */
  readonly meanPerBusySec: number | null;
  /** القبولُ ÷ (آخر − أوّل + 1) ثانية — يشملُ فجواتِ الخمولِ داخلَ النافذة. */
  readonly meanPerSpanSec: number | null;
  /** القبولُ لكلِّ ثانيةٍ منذُ `sinceMs` (أو منذُ أوّلِ قبولٍ إن لم يُعطَ) — للتحليلِ اللاحق. */
  readonly perSecond: readonly number[];
}

export interface EgressTimeline {
  readonly sinceMs: number | null;
  readonly byBot: Readonly<Record<string, EgressTimelineBot>>;
}

/**
 * يلخّصُ سجلَّ المحاكي (سطورَ JSONL فيها `t` بالـms و`bot` و`status`) لكلِّ بوت.
 * السطورُ الأقدمُ من `sinceMs` تُستبعَد (الملفُّ حلقةٌ متراكمةٌ عبرَ الجولات)،
 * والسطورُ غيرُ الصالحةِ تُتجاهَل كما في `readMockEgress`.
 */
export function summarizeEgressTimeline(
  lines: Iterable<string>,
  sinceMs: number | null,
): EgressTimeline {
  const acc: Record<string, { accepted: number; rejected: number; secs: Map<number, number> }> = {};
  for (const line of lines) {
    if (line.trim() === "") continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const t = Number(rec.t);
    if (sinceMs !== null && Number.isFinite(t) && t < sinceMs) continue;
    const bot = String(rec.bot ?? "?");
    acc[bot] ??= { accepted: 0, rejected: 0, secs: new Map() };
    const a = acc[bot];
    if (rec.status === 200) {
      a.accepted += 1;
      if (Number.isFinite(t)) {
        const s = Math.floor(t / 1000) * 1000;
        a.secs.set(s, (a.secs.get(s) ?? 0) + 1);
      }
    } else if (rec.status === 429) {
      a.rejected += 1;
    }
  }
  const byBot: Record<string, EgressTimelineBot> = {};
  for (const [bot, a] of Object.entries(acc)) {
    const keys = [...a.secs.keys()].sort((x, y) => x - y);
    const first = keys[0] ?? null;
    const last = keys.at(-1) ?? null;
    const timed = [...a.secs.values()].reduce((s, v) => s + v, 0);
    const origin = sinceMs === null ? first : Math.floor(sinceMs / 1000) * 1000;
    const perSecond: number[] = [];
    if (origin !== null && last !== null && last >= origin) {
      for (let s = origin; s <= last; s += 1000) perSecond.push(a.secs.get(s) ?? 0);
    }
    const round1 = (v: number) => Math.round(v * 10) / 10;
    byBot[bot] = {
      accepted: a.accepted,
      rejected: a.rejected,
      firstAcceptedSecMs: first,
      lastAcceptedSecMs: last,
      busySeconds: keys.length,
      peakPerSec: keys.length === 0 ? 0 : Math.max(...a.secs.values()),
      meanPerBusySec: keys.length === 0 ? null : round1(timed / keys.length),
      meanPerSpanSec:
        first === null || last === null ? null : round1(timed / ((last - first) / 1000 + 1)),
      perSecond,
    };
  }
  return { sinceMs, byBot };
}
