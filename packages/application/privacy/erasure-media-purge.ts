/**
 * الغرض: `WR-39` (قرارُ المالكِ 2026-11-03 · ADR 0306) — محوُ ملفّاتِ محادثةِ
 *   الحسابِ **فورًا بعدَ إتمامِ حذفِهِ**: التجهيلُ معاملةٌ واحدةٌ لا تُنقَضُ،
 *   وحذفُ ملفٍّ من مخزنِ الكائناتِ ليسَ كتابةَ قاعدةٍ — فلا يدخلُ المعاملةَ،
 *   بل يُنفَّذُ بعدها في طبقةِ التطبيقِ بنفسِ ترتيبِ مكنسةِ `WR-34`:
 *   **احذفِ الملفَّ من المخزنِ ثمَّ أتِمَّ السجلَّ**.
 *
 *   - سقوطُ العاملِ بينَ الحذفِ والإتمامِ: الصفوفُ باقيةٌ تُلتقَطُ ثانيةً —
 *     والحذفُ من المخزنِ متكرّرٌ بلا ضررٍ.
 *   - فشلُ المخزنِ: **لا إتمامَ للسجلِّ** (فلا تقولُ القاعدةُ «حُذف» وهوَ في
 *     المخزنِ)، والصفوفُ تبقى فتلتقطُها المكنسةُ الدوريّةُ (`message_gone` كلَّ
 *     600 ثانيةٍ) — شبكةُ أمانٍ لا مسارًا وحيدًا.
 *   - العزلُ: الالتقاطُ والإتمامُ مُقيَّدانِ بمعرّفِ صاحبِ الحسابِ المحوِّ في
 *     الدالتَينِ، فلا يمسُّ محوُ حسابٍ ملفَّ إنسانٍ آخرَ.
 *   - التكرارُ: طلبُ محوٍّ ثانٍ (ALREADY_ERASED) يُعيدُ المحاولةَ فيلتقطُ ما
 *     فاتَ — لا شيءٌ يُفلتُ إلا إلى المكنسةِ.
 *
 * الحالة: منفَّذٌ فعليًّا — `WR-39`.
 * ينتمي إلى: packages/application/privacy
 * يُستخدم من: `data-rights.ts` بعدَ نجاحِ `eraseMyAccount`
 * يُتوقع أن يستخدمه لاحقاً: لا أحدَ — قرارُ مالكٍ مُنفَّذ.
 */

import { ok, type Result } from "../../shared/result/index.ts";

export interface ErasureChatMediaPurgeItem {
  readonly id: string;
  readonly objectPath: string;
}

export interface ErasureChatMediaPurgeDeps {
  /** قراءةٌ لا قفلَ فيها — الإتمامُ متسامحٌ معَ التكرارِ. */
  readonly claim: (userId: string, limit: number) => Promise<readonly ErasureChatMediaPurgeItem[]>;
  /** حذفٌ من مخزنِ الكائناتِ — متكررٌ بلا ضررٍ (ما حُذفَ لا يُحذَفُ ثانيةً). */
  readonly remove: (objectPaths: readonly string[]) => Promise<Result<void, string>>;
  /** لا يمسُّ إلا صفوفَ صاحبِ الحسابِ — العزلُ شرطٌ في الدالّةِ لا أملٌ هنا. */
  readonly complete: (userId: string, ids: readonly string[]) => Promise<void>;
}

/** دفعةُ الالتقاطِ — لا نهايةَ للدالةِ (limit) في القاعدةِ فوقَ 500. */
export const ERASURE_MEDIA_PURGE_BATCH = 500;

/**
 * سقفُ الجولاتِ في المحاولةِ الواحدةِ: 40 دفعةً × 500 = 20000 ملفٍّ في محاولةٍ
 * واحدةٍ — فوقَها يُقالُ `deferred` لا تُعَلَّقُ الاستجابةُ إلى ما لا نهاية،
 * والباقي تلتقطُهُ المكنسةُ أو طلبُ محوٍّ تالٍ.
 */
export const ERASURE_MEDIA_PURGE_MAX_ROUNDS = 40;

export interface ErasureChatMediaPurgeReport {
  /** عددُ الملفّاتِ التي حُذفتْ وأُتِمَّ سجلُّها في هذه المحاولةِ. */
  readonly purged: number;
  /** true = بقيتْ صفوفٌ تُلتقَطُ لاحقًا (فشلُ مخزنٍ أو سقوطٌ بينَ الخطوتَينِ). */
  readonly deferred: boolean;
}

export async function purgeErasureChatMedia(
  deps: ErasureChatMediaPurgeDeps,
  userId: string,
): Promise<Result<ErasureChatMediaPurgeReport, string>> {
  let purged = 0;
  for (let round = 0; round < ERASURE_MEDIA_PURGE_MAX_ROUNDS; round += 1) {
    const items = await deps.claim(userId, ERASURE_MEDIA_PURGE_BATCH);
    if (items.length === 0) return ok({ purged, deferred: false });

    // **الترتيبُ مقصودٌ**: الملفُّ أوّلاً — فشلُ الحذفِ لا يُتِمُّ السجلَّ،
    // والصفوفُ تبقى كما هيَ فتُلتقَطُ ثانيةً (ههنا أو في المكنسةِ الدوريّةِ).
    const removed = await deps.remove(items.map((item) => item.objectPath));
    if (!removed.ok) return ok({ purged, deferred: true });

    // سقوطُ العاملِ بعدَ حذفِ الملفِّ وقبلَ الإتمامِ: الصفُّ يبقى `ready`
    // فتُلتقَطُ ثانيةً ويُحذَفُ ملفُّها مرةً ثانيةً بلا ضررٍ — لا يضيعُ شيءٌ.
    try {
      await deps.complete(
        userId,
        items.map((item) => item.id),
      );
    } catch {
      return ok({ purged, deferred: true });
    }
    purged += items.length;
  }
  // بلغَنا السقفَ وما زالَ هناكَ ما يُلتقَطُ — صادقٌ معَ النفسِ: مؤجَّلٌ.
  return ok({ purged, deferred: true });
}
