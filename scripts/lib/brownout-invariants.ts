/**
 * الغرض: حَكَمُ `F11-04` — لقطةُ بطءٍ في PostgreSQL (استعلاماتٌ عالقةٌ خلفَ قفلٍ على جدولٍ واحدٍ)
 *   تُقرأُ بقواعدَ مُسمّاةٍ: هل بقيَ مسارٌ لا صلةَ له بالجدولِ مخدوماً، وهل صارَ البطءُ مرصوداً
 *   ومحدوداً، وهل عادَ التجمُّعُ سليماً (`ADR 0197`).
 * الحالة: منفّذ فعلياً — يستعملُه tests/integration/pg-brownout.test.ts، وسالباتُه المبذورةُ
 *   في tests/unit/brownout-invariants.test.ts (`ح-7`).
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: قياسُ البطءِ أثناءَ الحملِ (`F10-*`) على اللقطةِ نفسِها.
 * ملاحظات مستقبلية: «لا انهيارٌ متتالٍ» يُقرأُ بزمنِ المسارِ غيرِ المعنيِّ مقارنةً بمدّةِ البطءِ،
 *   و«مرصودٌ» بإلغاءٍ مُسمّىً (`57014`) يبلغُ الخادمَ فعلاً لا بمؤقِّتٍ يتخلّى عن الاستعلامِ.
 */

/** هامشُ الزمنِ للجدولةِ والشبكةِ المحلّيّةِ؛ ليس جزءاً من أيِّ وعدٍ إنتاجيٍّ. */
export const BROWNOUT_SLACK_MS = 750;

export interface BrownoutSnapshot {
  /** مهلةُ الاستعلامِ على التجمُّعِ؛ `null` = بلا مهلةٍ (الحالُ قبلَ `F11-04`). */
  readonly deadlineMs: number | null;
  /** مدّةُ حبسِ القفلِ. */
  readonly brownoutMs: number;
  /** الاستعلاماتُ العالقةُ خلفَ القفلِ (أكثرُ من سقفِ التجمُّعِ عمداً). */
  readonly blocked: {
    readonly total: number;
    /** رُفِضَت بـ`57014` (إلغاءٌ). */
    readonly cancelled: number;
    /** نجحت (أي انتظرت حتى انتهى البطءُ). */
    readonly succeeded: number;
    /** أيُّ خطأٍ آخرَ. */
    readonly otherErrors: number;
    /** أطولُ زمنٍ حتى استقرَّ أحدُها. */
    readonly maxSettleMs: number;
  };
  /** مسارٌ لا يمسُّ الجدولَ المقفولَ، يُطلَقُ بعدَ امتلاءِ التجمُّعِ. */
  readonly unrelated: { readonly ok: boolean; readonly latencyMs: number };
  /** خوادمُ ما تزالُ تنتظرُ القفلَ بعدَ المهلةِ وقبلَ انتهاءِ البطءِ. */
  readonly serverWaitersAfterDeadline: number;
  /** نداءاتُ خطّافِ الرصدِ. */
  readonly deadlineHookCalls: number;
  /** استعلامٌ على الجدولِ نفسِه بعدَ انتهاءِ البطءِ. */
  readonly recovery: { readonly ok: boolean; readonly latencyMs: number };
  /** جلساتٌ «idle in transaction» بقيت من التجمُّعِ بعدَ الإلغاءِ. */
  readonly idleInTransaction: number;
}

export interface BrownoutVerdict {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

export function judgeBrownout(s: BrownoutSnapshot): BrownoutVerdict {
  const v: string[] = [];
  const settled = s.blocked.cancelled + s.blocked.succeeded + s.blocked.otherErrors;
  if (settled !== s.blocked.total) v.push("blocked.unsettled");
  if (!s.unrelated.ok) v.push("unrelated.not_served");
  // انتظرَ المسارُ غيرُ المعنيِّ البطءَ كلَّه ⇒ انهيارٌ متتالٍ.
  if (s.unrelated.latencyMs >= s.brownoutMs - BROWNOUT_SLACK_MS) v.push("unrelated.cascaded");
  if (s.deadlineMs === null) {
    v.push("deadline.absent");
  } else {
    if (s.unrelated.latencyMs > s.deadlineMs + BROWNOUT_SLACK_MS)
      v.push("unrelated.beyond_deadline");
    if (s.blocked.maxSettleMs > s.deadlineMs + BROWNOUT_SLACK_MS) v.push("blocked.beyond_deadline");
    if (s.blocked.cancelled === 0) v.push("blocked.not_observed");
    if (s.blocked.succeeded > 0) v.push("blocked.waited_out_brownout");
    if (s.deadlineHookCalls !== s.blocked.cancelled) v.push("hook.miscounted");
  }
  if (s.blocked.otherErrors > 0) v.push("blocked.wrong_error");
  // مؤقِّتٌ يتخلّى عن الاستعلامِ بلا إلغاءٍ يُخضِّرُ العميلَ ويتركُ الخادمَ عالقاً.
  if (s.serverWaitersAfterDeadline > 0) v.push("server.still_waiting");
  if (!s.recovery.ok || s.recovery.latencyMs > BROWNOUT_SLACK_MS) v.push("recovery.failed");
  if (s.idleInTransaction > 0) v.push("tx.left_open");
  return { ok: v.length === 0, violations: v };
}
