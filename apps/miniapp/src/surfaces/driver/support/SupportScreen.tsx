/**
 * الغرض: شاشةُ دعمِ السائقِ وشكواهُ — **وصفُ دورِه ودَينُه** فوقَ الشاشةِ
 *   المشتركةِ (البند `F3-08` · `SD-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-08` (الزيادةُ `S-5`).
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/support
 * يُستخدم من: `DriverRoot.tsx` (من شاشةِ الحسابِ ومن لوحِ العروضِ).
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لِمَ لا صنفَ مبدئيَّ في شاشةِ السائقِ
 *
 * خلافاً للراكبِ الذي يفتحُ الدعمَ **من تفاصيلِ رحلةٍ** فيُرجَّحُ أنَّه يشكو
 * منها: السائقُ يفتحُ الدعمَ من حسابِه، وشكواهُ الغالبةُ **مالٌ** لا رحلةٌ.
 * واختيارٌ مبدئيٌّ خاطئٌ أسوأُ من لا اختيارٍ: مَن لم ينظرْ أرسلَ في صنفٍ لم
 * يقصدْه، فتُصنَّفُ شكواهُ خطأً ويطولُ ردُّها.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا تُرفِقُ صورةً**: والدَّينُ أثقلُ ههنا مما هوَ عندَ الراكبِ — صورةُ
 *      إيصالِ خصمٍ هيَ الدليلُ. يُقالُ صراحةً في القائمةِ ولا يُوهَمُ بزرٍّ.
 *   ــ **لا تفتحُ محادثةً**: الردُّ في قروبِ المدينةِ اليومَ.
 *   ــ **لا تُنشئُ اعتراضاً ماليّاً يُعالِجُ نفسَه**: التذكرةُ **بلاغٌ لا قيدٌ**؛
 *      وردُّ مبلغٍ قرارُ إنسانٍ في لوحِ الإدارةِ، ولا سبيلَ من ههنا إلى محفظةٍ.
 *   ــ **لا تعرضُ رصيدَ اشتراكٍ ولا خصوماً**: شاشةُ الاشتراكِ (`SD-07`) موضعُها،
 *      وتكرارُ رقمٍ ماليٍّ في شاشتَينِ يُنتِجُ رقمَينِ يفترقانِ.
 */

import type { MiniAppLanguage } from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import { TicketsScreen } from "../../support/TicketsScreen.tsx";
import type { ReadTicketsInput } from "../../support/ticket-api.ts";
import type { OpenTicketResponse, SupportTicketsResponse } from "../../support/ticket-contract.ts";
import { openDriverSupportTicket, readDriverSupportTickets } from "./support-api.ts";
import {
  DEFAULT_SUPPORT_PAGE_SIZE,
  DRIVER_SUPPORT_SPEC,
  DRIVER_SUPPORT_VIEW,
  type DriverSupportCategory,
} from "./support-view.ts";

export interface DriverSupportScreenProps {
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  /**
   * رحلةٌ جاءَ منها السائقُ (شاشةُ المَهمّةِ أو سجلُّ نشاطِه) — **تُثبَّتُ ولا
   * تُكتَبُ بيدٍ**، وبها وحدَها يُفتَحُ صنفُ «راكبٍ مسيءٍ».
   */
  readonly orderId?: string | null;
  readonly openTicket?: (input: {
    readonly category: DriverSupportCategory;
    readonly message: string;
    readonly orderId: string | null;
  }) => Promise<OpenTicketResponse>;
  readonly readTickets?: (input: ReadTicketsInput) => Promise<SupportTicketsResponse>;
}

/** ما لا سندَ له في هذه الشاشةِ — يُقالُ ولا يُوضَعُ له زرٌّ صوريٌّ. */
const DECLARED_DEBT: readonly string[] = [
  "driver.support.debt.attachment",
  "driver.support.debt.thread",
  "driver.support.debt.deductionTrace",
];

export function DriverSupportScreen({
  language,
  onBack,
  orderId = null,
  openTicket,
  readTickets = readDriverSupportTickets,
}: DriverSupportScreenProps) {
  const open = (input: {
    readonly category: string;
    readonly message: string;
    readonly orderId: string | null;
  }): Promise<OpenTicketResponse> =>
    openTicket === undefined
      ? openDriverSupportTicket(input)
      : openTicket({
          category: input.category as DriverSupportCategory,
          message: input.message,
          orderId: input.orderId,
        });

  return (
    <TicketsScreen
      declaredDebt={DECLARED_DEBT}
      // لا صنفَ مبدئيَّ — انظرْ رأسَ المِلفِّ.
      initialCategory={null}
      language={language}
      onBack={onBack}
      openTicket={open}
      orderId={orderId}
      pageSize={DEFAULT_SUPPORT_PAGE_SIZE}
      readTickets={readTickets}
      spec={DRIVER_SUPPORT_SPEC}
      view={DRIVER_SUPPORT_VIEW}
    />
  );
}
