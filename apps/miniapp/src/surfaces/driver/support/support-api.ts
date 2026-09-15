/**
 * الغرض: نداءا دعمِ السائقِ — **مسارُه وحدَه** فوقَ النواةِ المشتركةِ
 *   (البند `F3-08` · `SD-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-08` (الزيادةُ `S-5`).
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/support
 * يُستخدم من: `SupportScreen.tsx`
 *
 * ## لِمَ للسائقِ مسارٌ ثالثٌ ولا حقلُ دورٍ في جسمِ الطلبِ
 *
 * لأنَّ الدورَ **مصدرُ سلطةٍ لا رأيُ عميلٍ**: حقلٌ في الجسمِ يجعلُ العميلَ
 * يُصرِّحُ بدورِه، والخادمُ يُصدِّقُه أو يُكرِّرُ الحكمَ. والمسارُ يجعلُ الدورَ
 * **في العنوانِ** فيُقرأُ في السجلِّ وفي حدِّ التوجيهِ وفي كلِّ أثرٍ — والقاعدةُ
 * تحكمُ بصفِّ السياقةِ لا بما قالَه العميلُ.
 */

import { supportTicketsApi } from "../../support/ticket-api.ts";

export type * from "../../support/ticket-contract.ts";

/** مسارُ السائقِ — **الدورُ في العنوانِ** لا في الجسمِ. */
export const DRIVER_SUPPORT_PATH = "/v1/driver/support/tickets";

const api = supportTicketsApi(DRIVER_SUPPORT_PATH);

export const openDriverSupportTicket = api.openTicket;
export const readDriverSupportTickets = api.readTickets;
