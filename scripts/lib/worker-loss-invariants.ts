/**
 * الغرض: حَكَمُ `F11-02` — لقطةٌ بعدَ قتلِ عاملٍ حقيقيٍّ وتسلُّمِ ثانٍ تُقرأُ بقواعدَ مُسمّاةٍ.
 * الحالة: منفّذ فعلياً — يستعملُه tests/integration/worker-loss-reclaim.test.ts، وسالباتُه
 *   المبذورةُ في tests/unit/worker-loss-invariants.test.ts (`ح-7`).
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: قياسُ فقدانِ العاملِ أثناءَ الحملِ (`F10-*`) على اللقطةِ نفسِها.
 * ملاحظات مستقبلية: «بلا تكرارِ أثرٍ» يُقرأُ في **القاعدةِ** (صفٌّ واحدٌ يُسلَّمُ مرّةً · رمزُ الميّتِ
 *   مرفوضٌ)، أمّا الرسالةُ الخارجيّةُ فعددُها يُقارَنُ بالحدِّ المُعلَنِ في `ADR 0195` لا بصفرٍ.
 */

export interface WorkerLossSnapshot {
  /** أقفالُ المهمّةِ الاستشاريّةُ الممنوحةُ بعدَ موتِ الأوّلِ وقبلَ إقلاعِ الثاني. */
  readonly advisoryLocksAfterKill: number;
  /** صفوفُ الصادرِ لهذا العرضِ. */
  readonly rows: readonly {
    readonly status: string;
    readonly attempts: number;
    readonly messageId: string | null;
    readonly claimToken: string | null;
  }[];
  /** رمزُ الحجزِ الذي ماتَ معه الأوّلُ. */
  readonly deadClaimToken: string;
  /** نتيجةُ إعلانٍ متأخِّرٍ برمزِ الميّتِ بعدَ التسليمِ. */
  readonly lateFinishAccepted: boolean;
  /** معرّفُ الرسالةِ بعدَ الإعلانِ المتأخِّرِ. */
  readonly messageIdAfterLateFinish: string | null;
  /** الرسائلُ التي بلغَت تيليجرامَ المُزيَّفَ لهذا العرضِ. */
  readonly sends: number;
  /** الحدُّ المُعلَنُ للطورِ: 1 إن ماتَ قبلَ الإرسالِ · 2 إن ماتَ بعدَ الوصولِ وقبلَ الإقرارِ. */
  readonly sendBound: number;
  /** عروضُ الطلبِ في القاعدةِ. */
  readonly offers: number;
}

export interface WorkerLossVerdict {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

export function judgeWorkerLoss(s: WorkerLossSnapshot): WorkerLossVerdict {
  const v: string[] = [];
  const row = s.rows[0];
  if (s.advisoryLocksAfterKill !== 0) v.push("lock.survived_process_death");
  if (s.rows.length !== 1) v.push("outbox.row_count");
  if (row !== undefined) {
    if (row.status !== "delivered") v.push("outbox.not_delivered");
    if (row.messageId === null) v.push("outbox.no_message_id");
    if (row.attempts < 2) v.push("outbox.reclaim_not_counted");
    if (row.claimToken === s.deadClaimToken) v.push("outbox.dead_token_still_owns");
  }
  if (s.lateFinishAccepted) v.push("finish.dead_token_accepted");
  if (row !== undefined && s.messageIdAfterLateFinish !== row.messageId) {
    v.push("finish.dead_token_overwrote");
  }
  if (s.sends < 1) v.push("send.lost");
  if (s.sends > s.sendBound) v.push("send.beyond_bound");
  if (s.offers !== 1) v.push("offer.duplicated");
  return { ok: v.length === 0, violations: v };
}
