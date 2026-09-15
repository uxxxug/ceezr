/**
 * الغرض: شاشةُ دعمِ الراكبِ — **وصفُ دورِه ودَينُه** فوقَ الشاشةِ المشتركةِ
 *   (البند `F2-12` · `SR-11` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`، **وصارَت باباً بـ`F3-08`** (`S-5`).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/support
 * يُستخدم من: `RiderRoot.tsx` (من شاشةِ الحسابِ ومن تفاصيلِ رحلةٍ).
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لِمَ بقيَ توقيعُ `SupportScreenProps` كما كانَ حرفاً
 *
 * لأنَّ `RiderRoot` يُنادي `<SupportScreen orderId=… onBack=… />`، والاختبارُ
 * يُمرِّرُ `openTicket` و`readTickets` مصنوعَينِ. وتغييرُ توقيعٍ عاملٍ لأجلِ
 * إعادةِ تنظيمٍ **نقصٌ في سلوكٍ ناجحٍ** (`ح-8`) — فالمنافذُ كما هيَ والجسدُ
 * صارَ مشتركاً.
 *
 * ## ولِمَ الصنفُ المبدئيُّ «شكوى رحلةٍ» حينَ جاءَ من رحلةٍ
 *
 * لأنَّ راكباً فتحَ الدعمَ من تفاصيلِ رحلةٍ **يشكو منها في الغالبِ**، وقائمةٌ
 * بلا اختيارٍ مبدئيٍّ تسألُه ما قد أجابَ عنه بفعلِه. وهوَ **مبدئيٌّ لا قطعيٌّ**.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا تُرفِقُ صورةً** ولا **تفتحُ محادثةً** ولا **تعرضُ أسئلةً شائعةً ولا
 *      صفحةَ مفقوداتٍ**: أربعةُ دُيونٍ مُعلَنةٍ تُقالُ في القائمةِ أسفلَ الشاشةِ،
 *      وبها يبقى البندُ `F2-12` عندَ `[~]`.
 *   ــ **لا تُظهِرُ زرَّ إعادةٍ فوقَ تهدئةٍ**: تقولُ الثانيةَ الباقيةَ.
 */

import type { MiniAppLanguage } from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import { TicketsScreen } from "../../support/TicketsScreen.tsx";
import type { OpenTicketInput, ReadTicketsInput } from "../../support/ticket-api.ts";
import type { OpenTicketResponse, SupportTicketsResponse } from "../../support/ticket-contract.ts";
import { openSupportTicket, readSupportTickets } from "./support-api.ts";
import {
  DEFAULT_SUPPORT_PAGE_SIZE,
  RIDER_SUPPORT_SPEC,
  RIDER_SUPPORT_VIEW,
  type RiderSupportCategory,
} from "./support-view.ts";

export interface SupportScreenProps {
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  /**
   * رحلةٌ جاءَ منها الراكبُ (`F2-08` تفاصيلُ رحلةٍ) — **تُثبَّتُ ولا تُكتَبُ
   * بيدٍ**: حقلُ معرّفٍ يُملأُ يدويّاً بابُ خطأٍ لا بابُ دعمٍ.
   */
  readonly orderId?: string | null;
  readonly openTicket?: (input: {
    readonly category: RiderSupportCategory;
    readonly message: string;
    readonly orderId: string | null;
  }) => Promise<OpenTicketResponse>;
  readonly readTickets?: (input: ReadTicketsInput) => Promise<SupportTicketsResponse>;
}

/** ما لا سندَ له في هذه الشاشةِ — يُقالُ ولا يُوضَعُ له زرٌّ صوريٌّ. */
const DECLARED_DEBT: readonly string[] = [
  "rider.support.debt.attachment",
  "rider.support.debt.thread",
  "rider.support.debt.faq",
  "rider.support.debt.lostFound",
];

export function SupportScreen({
  language,
  onBack,
  orderId = null,
  openTicket,
  readTickets = readSupportTickets,
}: SupportScreenProps) {
  const open = (input: OpenTicketInput): Promise<OpenTicketResponse> =>
    openTicket === undefined
      ? openSupportTicket(input)
      : openTicket({
          category: input.category as RiderSupportCategory,
          message: input.message,
          orderId: input.orderId,
        });

  return (
    <TicketsScreen
      declaredDebt={DECLARED_DEBT}
      // رحلةٌ جاءَ منها الراكبُ = شكوى رحلةٍ **مبدئيّاً** لا قطعاً: يُبدِّلُها.
      initialCategory={orderId === null ? null : "ride_dispute"}
      language={language}
      onBack={onBack}
      openTicket={open}
      orderId={orderId}
      pageSize={DEFAULT_SUPPORT_PAGE_SIZE}
      readTickets={readTickets}
      spec={RIDER_SUPPORT_SPEC}
      view={RIDER_SUPPORT_VIEW}
    />
  );
}
