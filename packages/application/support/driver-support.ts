/**
 * الغرض: حالتا استخدامِ دعمِ السائقِ — «افتحْ شكوى بأصنافِه» و«تذاكري
 *   وحالاتُها» (`F3-08` · `SD-10` · §9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-08`.
 * ينتمي إلى: packages/application/support
 * يُستخدم من: `apps/gateway/src/routes/support-tickets.ts`
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لِمَ هذا الملفُّ ثلاثةُ أسطرِ منطقٍ ولا أكثرُ
 *
 * لأنَّ منطقَ الاستقبالِ **واحدٌ في `intake.ts`**، والمختلفُ **مواصفةُ الدورِ**
 * وحدَها. فما يُقرأُ ههنا هوَ الفرقُ نفسُه: أصنافُ السائقِ، وأنَّ «راكباً
 * مسيئاً» يلزمُها رحلةٌ. **وكلُّ ما وراءَ ذلكَ لا يُنسَخُ**: مَن نسخَ الجلسةَ
 * والتهدئةَ والترقيمَ إلى ملفٍّ ثانٍ حكمَ على نفسِه بإصلاحِ كلِّ عطبٍ مرَّتَينِ.
 *
 * ## وما لا يفعلُه عن قصدٍ (`ح-5`)
 *
 *   ــ **لا يفحصُ أنَّ الطالبَ سائقٌ**: تفحصُه القاعدةُ (`NOT_A_DRIVER`) —
 *      وهوَ الموضعُ الوحيدُ الذي يعرفُ صفَّ السائقِ، فلا فحصَ ثانٍ يتخلَّفُ.
 *   ــ **لا يقرأُ حصيلةً ولا خصماً**: شكوى «خصمٍ» **نصٌّ** يُفتَحُ به بابُ
 *      مراجعةٍ بشريّةٍ؛ وحسابُ الخصمِ نفسِه في مسارِه (`F3-06`).
 *   ــ **لا يُغلِقُ تذكرةً ولا يردُّ عليها**: دَينٌ مُعلَنٌ كما عندَ الراكبِ.
 */

import {
  type DriverSupportCategory,
  driverCategoryRequiresOrder,
  isDriverSupportCategory,
} from "../../domain/support/driver-support.ts";
import type {
  OpenedSupportTicketOf,
  SupportTicketsPage,
} from "../../domain/support/ticket-types.ts";
import type { Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import {
  listSupportTickets,
  openSupportTicket,
  type SupportRejection,
  type SupportRoleSpec,
} from "./intake.ts";
import type { DriverSupportStore } from "./ports.ts";

export interface DriverSupportDeps {
  readonly sessions: MiniAppSessionReader;
  readonly store: DriverSupportStore;
  readonly now: () => Date;
}

/** إيصالُ فتحِ تذكرةِ سائقٍ — صنفُه من مجالِ السائقِ لا من النوعِ كلِّه. */
export type OpenedDriverSupportTicket = OpenedSupportTicketOf<DriverSupportCategory>;

/** مواصفةُ دورِ السائقِ — الفرقُ كلُّه، مكتوباً في موضعٍ واحدٍ. */
const DRIVER_ROLE: SupportRoleSpec<DriverSupportCategory> = {
  isCategory: isDriverSupportCategory,
  requiresOrder: driverCategoryRequiresOrder,
};

export function openDriverSupportTicket(
  deps: DriverSupportDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly category: unknown;
    readonly message: unknown;
    readonly orderId: unknown;
  },
): Promise<Result<OpenedDriverSupportTicket, SupportRejection>> {
  return openSupportTicket(deps, DRIVER_ROLE, input);
}

export function listDriverSupportTickets(
  deps: DriverSupportDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly limit: unknown;
    readonly cursorCreatedAt: unknown;
    readonly cursorId: unknown;
  },
): Promise<Result<SupportTicketsPage, SupportRejection>> {
  return listSupportTickets(deps, input);
}
