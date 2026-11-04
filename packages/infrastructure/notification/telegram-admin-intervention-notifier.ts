/**
 * الغرض: رسالةُ التدخّلِ الإداريِّ للسائقِ على تيليجرام (`WR-42`): «قُطِعَت
 *   رحلتُك / أُنهيت رحلتُك بقرارٍ من الإدارة»، والسببُ كما كتبَهُ المشرفُ إن
 *   كتبَهُ للسائقِ نصًّا، وإحالةٌ إلى الدعمِ لسؤالِ ما ليسَ في الرسالةِ. تُرسَلُ
 *   ببوتِ السائقِ حصراً وبلا لوحةِ أزرارٍ: القرارُ مُتَّخَذٌ ولا فعلَ بقيَ.
 * الحالة: منفّذ فعلياً — 2026-11-04 (`WR-42`).
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: apps/workers/src/container.ts (عاملُ صندوقِ الصادرِ)
 * ملاحظات مستقبلية: لا شيءَ.
 */

import type {
  AdminInterventionMessenger,
  AdminInterventionNotice,
} from "../../application/dispatch/deliver-admin-intervention-notification.ts";
import { t } from "../../shared/i18n/index.ts";
import { guard } from "../db/client.ts";
import type { IdentifyingSender } from "./telegram-negotiation-notifier.ts";

export function createTelegramAdminInterventionMessenger(
  driverSender: IdentifyingSender,
): AdminInterventionMessenger {
  return {
    sendAdminIntervention: (notice: AdminInterventionNotice) =>
      guard("notifier.adminIntervention", async () => {
        const tr = t(notice.language);
        const key =
          notice.action === "complete"
            ? "driver.admin_intervention_completed"
            : "driver.admin_intervention_cancelled";
        const base = tr(key, { order: notice.orderId.slice(0, 8) });
        const text =
          notice.reason === null
            ? base
            : `${base}\n${tr("driver.admin_intervention_reason", { reason: notice.reason })}`;
        return driverSender.sendReturningId(notice.chatId, text, null);
      }),
  };
}
