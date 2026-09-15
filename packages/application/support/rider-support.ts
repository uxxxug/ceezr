/**
 * الغرض: حالتا استخدامِ الدعمِ من داخلِ التطبيقِ — «افتحْ شكوى» و«تذاكري
 *   وحالاتُها» (`F2-12` · `SR-11` · §9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`؛ ومنطقُه مُستخرَجٌ إلى
 *   `intake.ts` في `F3-08` بلا تغييرِ سلوكٍ ولا تبديلِ اسمٍ مُصدَّرٍ.
 * ينتمي إلى: packages/application/support
 * يُستخدم من: `apps/gateway/src/routes/support-tickets.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-10` — الدورُ لا يُذكَرُ في هذه الطبقةِ،
 *   والسائقُ يدخلُ من المسارِ نفسِه بأصنافِه.
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لماذا يُفحَصُ الصنفُ والنصُّ **ههنا** والقاعدةُ تفحصُ أيضاً
 *
 * ليسَ تكراراً بل **بابانِ لواحدةٍ**: القاعدةُ تحرسُ البيانةَ من كلِّ نداءٍ
 * (بوتٌ · بوابةٌ · لوحةٌ)، وهذه الطبقةُ تُحوِّلُ خطأَ الإنسانِ إلى **رمزٍ
 * مُصنَّفٍ ونصِّ شاشةٍ** قبلَ أن يُنفَقَ ذَهابٌ إلى القاعدةِ. ولو تُرِكَ الصنفُ
 * يمرُّ نصّاً لَعادَ `22P02` من مُحرِّكِ القاعدةِ — وذاكَ يُقرأُ `503` لا `422`،
 * فيظنُّ المستخدمُ العطبَ عندَنا وهو في اختيارِه.
 *
 * ## ولماذا لا مفتاحُ تكرارٍ (`Idempotency-Key`) على فتحِ التذكرةِ
 *
 * لأنَّ **التهدئةَ هي حاجزُ التكرارِ ههنا**: `support_ticket_cooldown_seconds`
 * يمنعُ تذكرةً ثانيةً لصاحبِها قبلَ مُضيِّ مُدَّتِه، فإعادةُ الإرسالِ من شبكةٍ
 * متعثِّرةٍ تُردُّ `COOLDOWN_ACTIVE` **لا تُنشئُ تذكرتَينِ**. ومفتاحُ تكرارٍ
 * فوقَه جدولُ مفاتيحٍ ثانٍ وحاجزٌ ثانٍ لِما هو محروسٌ في القاعدةِ — و«أقلُّ
 * مصادرِ حقيقةٍ مُكرَّرةٍ» يردُّه. **وهذا ليسَ إعفاءً عامّاً**: القسم 10 يوجبُ
 * المفتاحَ على الأوامرِ التي **لا حاجزَ لها في القاعدةِ**، وأمرُ إنشاءِ الرحلةِ
 * منها فمفتاحُه إلزاميٌّ.
 *
 * ## وما لا تفعلُه هاتانِ الحالتانِ عن قصدٍ — وحدودُه مُعلَنةٌ (`ح-5`)
 *
 *   ــ **لا تقرآنِ معرّفاً من الجسمِ**: معرّفُ صاحبِ التذكرةِ من الرمزِ
 *      الموقَّعِ وحدَه؛ و`orderId` **يُقرأُ** من الجسمِ لكنَّ مِلكيّتَه
 *      تُفحَصُ في القاعدةِ (`ORDER_NOT_YOURS`) لا ههنا.
 *   ــ **لا تُرفِقانِ صورةً**: `attachment_file_id` بابُ تيليجرامَ وحدَه اليومَ؛
 *      ورفعُ ملفٍّ من التطبيقِ المصغَّرِ **دَينٌ مُعلَنٌ** لا مُنفَّذٌ.
 *   ــ **لا تُغلِقانِ تذكرةً ولا تُضيفانِ رسالةً إليها**: المحادثةُ في قروبِ
 *      المدينةِ (`claim/resolve` قائمانِ)، **والردُّ داخلَ التطبيقِ دَينٌ
 *      مُعلَنٌ** في `ROADMAP` لا يُدَّعى ههنا.
 *   ــ **لا تُرسِلانِ إشعاراً**: بطاقةُ القروبِ يكتبُها المُشغِّلُ القائمُ
 *      (`post-dispute-card.ts`) على المصدرِ نفسِه، ولا يُنسَخُ إرسالٌ ثانٍ.
 */

/**
 * رموزُ العطبِ التي **تُنشَرُ** — مجالٌ مغلقٌ تُقابِلُه خريطةُ حالاتٍ شاملةٌ.
 * وهيَ **قائمةٌ تُقرأُ في زمنِ التشغيلِ** لا اتّحادٌ أنواعٍ وحدَه: الحاجزُ الذي
 * يُلزِمُ أنَّ لكلِّ رمزٍ نصّاً في القواميسِ الثلاثةِ لا يرى الأنواعَ، ونسخُ القائمةِ
 * في الحاجزِ يجعلُها **مصدرَ حقيقةٍ ثانياً** يتخلّفُ عندَ أوّلِ رمزٍ جديدٍ (القاعدة 0.6).
 */
import {
  categoryRequiresOrder,
  isRiderSupportCategory,
  type OpenedSupportTicket,
  type RiderSupportCategory,
  type RiderSupportPage,
} from "../../domain/support/rider-support.ts";
import type { Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import {
  listSupportTickets,
  openSupportTicket,
  SUPPORT_PUBLIC_ERROR_CODES,
  type SupportPublicErrorCode,
  type SupportRejection,
  type SupportRoleSpec,
} from "./intake.ts";
import type { RiderSupportStore } from "./ports.ts";

/**
 * رموزُ العطبِ المنشورةُ — **واحدةٌ للدورَينِ** في `intake.ts`، وتُصدَّرُ ههنا
 * بالاسمِ الذي يقرؤه حاجزُ `support-intake-contract` والقواميسُ (`ح-8`).
 */
export const RIDER_SUPPORT_PUBLIC_ERROR_CODES = SUPPORT_PUBLIC_ERROR_CODES;
export type RiderSupportPublicErrorCode = SupportPublicErrorCode;
export type RiderSupportRejection = SupportRejection;

export interface RiderSupportDeps {
  readonly sessions: MiniAppSessionReader;
  readonly store: RiderSupportStore;
  readonly now: () => Date;
}

/** مواصفةُ دورِ الراكبِ — مجالُ أصنافِه وما يلزمُه رحلةً منها. */
const RIDER_ROLE: SupportRoleSpec<RiderSupportCategory> = {
  isCategory: isRiderSupportCategory,
  requiresOrder: categoryRequiresOrder,
};

export function openRiderSupportTicket(
  deps: RiderSupportDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly category: unknown;
    readonly message: unknown;
    readonly orderId: unknown;
  },
): Promise<Result<OpenedSupportTicket, RiderSupportRejection>> {
  return openSupportTicket(deps, RIDER_ROLE, input);
}

export function listRiderSupportTickets(
  deps: RiderSupportDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly limit: unknown;
    readonly cursorCreatedAt: unknown;
    readonly cursorId: unknown;
  },
): Promise<Result<RiderSupportPage, RiderSupportRejection>> {
  return listSupportTickets(deps, input);
}
