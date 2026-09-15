/**
 * الغرض: عقدُ سطحِ دعمِ الراكبِ — **بابٌ إلى النواةِ المشتركةِ** مع اتّحادِ
 *   أصنافِ الراكبِ الذي تحتاجُه شاشتُه (البند `F2-12` · `SR-11`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`، **وصارَ باباً بـ`F3-08`** (`S-5`).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/support
 * يُستخدم من: `support-api.ts` · `support-view.ts` · `SupportScreen.tsx`
 *   · `tests/unit/rider-support-view.test.ts`
 *
 * ## لِمَ صارَ باباً ولم يبقَ نسخةً
 *
 * لأنَّ شكلَ الردِّ يبنيهِ **مُسَجِّلُ مسارٍ واحدٌ** للدورَينِ، ونسختانِ منه
 * تفترقانِ عندَ أوّلِ حقلٍ يُزادُ — والعطبُ صامتٌ: `undefined` في موضعِ نصٍّ.
 * والأنواعُ المُصدَّرةُ ههنا **بأسمائِها القديمةِ حرفاً** (`ح-8`): ما استوردَها
 * يستوردُها كما كانَ، ولا مُستوردَ واحدٌ يُمَسُّ.
 *
 * ## وما لا يصفُه هذا الملفُّ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا مُرفَقَ ولا صورةً** ولا **محادثةً** ولا **اسمَ موظّفٍ**: مُفصَّلةٌ
 *      في رأسِ `../../support/ticket-contract.ts`.
 */

export type {
  ApiSupportCursor,
  ApiSupportStatus,
  ApiSupportTicket,
  OpenTicketResponse,
  SupportTicketsResponse,
} from "../../support/ticket-contract.ts";

/**
 * أصنافُ شكوى الراكبِ كما تُقبَلُ في الخادمِ — **نسخةُ عرضٍ لا مصدرُ حقيقةٍ**،
 * ومصدرُها `packages/domain/support/rider-support.ts`. وتبقى ههنا لأنَّ
 * `SupportScreenProps` تُصرِّحُ بها في توقيعِها.
 */
export type ApiSupportCategory =
  | "ride_dispute"
  | "lost_item"
  | "driver_conduct"
  | "app_problem"
  | "other";
