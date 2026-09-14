/**
 * الغرض: عقدُ قراءةِ حالِ سطحِ الاستغاثةِ بينَ طبقةِ التطبيقِ والقاعدةِ
 *   (`F2-10` · `SR-14`) — وقائعُ الحالِ وحدَها **بلا نصٍّ معروضٍ**.
 * الحالة: منفَّذٌ فعليّاً — البند `F2-10`.
 * ينتمي إلى: packages/application/safety
 * يُستخدم من: `sos-surface.ts` · `infrastructure/safety/sos-surface-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: سطحُ السائقِ في التطبيقِ المصغَّرِ — يقرأُ هذا
 *   العقدَ نفسَه بدورٍ آخرَ، ولا يُكتَبُ عقدٌ ثانٍ للسؤالِ نفسِه.
 * الحاكم: docs/adr/0111-sos-surface-is-a-judged-card-not-a-button.md
 *
 * ## لماذا **قراءةٌ** فقط في هذا العقدِ
 *
 * الكتابةُ لها منفذٌ قائمٌ منذُ 2026-08-13 (`TriggerSosPort`) يستعملُه البوتانِ
 * وسيستعملُه هذا السطحُ حرفاً. وإضافةُ `trigger` ههنا كانت ستعني منفذَينِ
 * لكتابةٍ واحدةٍ، ويومَ يتغيَّرُ شرطُ الملكيّةِ في القاعدةِ يُحدَّثُ أحدُهما
 * ويُنسى الآخرُ (القاعدة 0.6). فالجديدُ **سؤالٌ لم يكن يُسألُ**: «أيجوزُ لي
 * النداءُ الآنَ، وما مصيرُ ندائي السابقِ، وماذا سيُفصَحُ عنّي؟».
 *
 * ## ولماذا الرفضُ **ثلاثةُ رموزٍ مُصنَّفةٍ** لا `null` واحدٌ
 *
 * «دورٌ مجهولٌ» عطبُ مُنادٍ، و«لا حسابَ» جلسةٌ لحسابٍ مُزالٍ، و«محجوبٌ» حكمُ
 * منصّةٍ. وطيُّها في جوابٍ واحدٍ يجعلُ الشاشةَ تقولُ الجملةَ نفسَها للثلاثةِ،
 * ويجعلُ المراقبةَ عمياءَ عن أيِّها يقعُ فعلاً.
 */

import type { SosSurfaceState } from "../../domain/safety/sos-surface.ts";
import type { Result } from "../../shared/result/index.ts";
import type { SafetyRole } from "./ports.ts";

/** عطبُ مخزنٍ — **لا يُخلَطُ بحكمِ حالةٍ**: هذا يُنشَرُ `503` لا `200`. */
export interface SosStoreFailure {
  readonly reason: "USER_NOT_FOUND" | "STORE_ERROR";
}

/** رفضٌ مُصنَّفٌ يُنشَرُ `200`: سؤالٌ صحيحٌ وجوابُه أنَّ السطحَ لا يُعرَضُ. */
export type SosSurfaceRefusal = "INVALID_ROLE" | "ACCOUNT_NOT_FOUND" | "ACCOUNT_BLOCKED";

export type SosSurfaceVerdict =
  | { readonly found: true; readonly state: SosSurfaceState }
  | { readonly found: false; readonly refusal: SosSurfaceRefusal };

export interface SosSurfaceReader {
  read(input: {
    readonly telegramUserId: string;
    readonly role: SafetyRole;
  }): Promise<Result<SosSurfaceVerdict, SosStoreFailure>>;
}
