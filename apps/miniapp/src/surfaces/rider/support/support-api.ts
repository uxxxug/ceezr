/**
 * الغرض: نداءا دعمِ الراكبِ — **مسارُه وحدَه** فوقَ النواةِ المشتركةِ
 *   (البند `F2-12`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`، **وصارَ باباً بـ`F3-08`** (`S-5`).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/support
 * يُستخدم من: `SupportScreen.tsx`
 *
 * ## لِمَ المسارُ مكتوبٌ ههنا حرفاً
 *
 * لأنَّه **الشيءُ الذي يفترقُ فيه الدورانِ** — ومسارٌ يُبنى بقالبٍ من اسمِ دورٍ
 * يجعلُ خطأً في حرفٍ ٤٠٤ في زمنِ التشغيلِ لا خطأَ بناءٍ.
 */

import { supportTicketsApi } from "../../support/ticket-api.ts";

export type * from "./support-contract.ts";

/** مسارُ الراكبِ — **بلا دورٍ في العنوانِ**، وهوَ الأقدمُ وقد بقيَ كما هوَ. */
export const RIDER_SUPPORT_PATH = "/v1/support/tickets";

const api = supportTicketsApi(RIDER_SUPPORT_PATH);

export const openSupportTicket = api.openTicket;
export const readSupportTickets = api.readTickets;
