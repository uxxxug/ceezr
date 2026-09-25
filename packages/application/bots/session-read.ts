/**
 * الغرض: قراءةُ جلسةِ الحوارِ تُفرِّقُ **الغيابَ** من **الإخفاقِ** (`D-36` · `ADR 0194`).
 *   مستخدمٌ بلا جلسةٍ يبدأُ من البدايةِ؛ ومستخدمٌ تعذَّرَت قراءةُ جلستِه **لا يُعرَفُ طورُه**،
 *   فمُدخَلٌ لا معنى له إلّا بالطورِ (نقطةُ موقعٍ · صورةٌ · زرُّ خطوةٍ · نصٌّ حرٌّ) يُجابُ
 *   بعطلٍ صادقٍ لا بـ«لم أفهم»، ولا تُكتَبُ البدايةُ فوقَ جلسةٍ لعلَّها باقيةٌ.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: packages/application/bots
 * يُتوقع أن يستخدمه لاحقاً: كلُّ بوتٍ يحملُ حواراً بخطواتٍ.
 * ملاحظات مستقبلية: ما مصدرُ حقيقتِه القاعدةُ (نقراتُ العرضِ والرحلةِ والتقييمِ، والأوامرُ،
 *   وموقعُ السائقِ الحيُّ) لا يمرُّ بهذا الحكمِ — هوَ ما يُبقي الدورةَ التجاريّةَ حيّةً
 *   أثناءَ فقدانِ Redis (`F11-03` · `ADR 0193`).
 */

import type { DialogState, SessionStore } from "./types.ts";

export interface SessionRead {
  readonly state: DialogState;
  /** `true` حينَ **أخفقَت** القراءةُ؛ الغيابُ الصادقُ `false`. */
  readonly unreadable: boolean;
}

export async function readDialogSession(
  sessions: SessionStore,
  telegramUserId: string,
  initial: DialogState,
): Promise<SessionRead> {
  const stored = await sessions.load(telegramUserId);
  if (!stored.ok) return { state: initial, unreadable: true };
  return { state: stored.value ?? initial, unreadable: false };
}
