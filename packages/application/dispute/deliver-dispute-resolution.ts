/**
 * الغرض: معالجُ نوعِ «dispute_resolution» في صندوقِ الصادرِ الموحَّدِ (BUG-004):
 *   يبلّغُ صاحبَ التذكرةِ بقرارِ الدعمِ بعدَ commit القرارِ لا قبلَه. معرّفُ تلغرامَ
 *   ولغتُه وصنفُه يأتونَ في الحمولةِ كما قرأتهم القاعدةُ حيّةً لحظةَ الالتقاطِ — لا
 *   نسخةً مخزَّنةً في الجدولِ — فتبليغُ من غيّرَ لغتَه يصلُ بلغتِه الأخيرةِ. والمُرسِلُ
 *   يُختارُ بصنفِ صاحبِ التذكرةِ: الرسالةُ الخاصّةُ تصلُه من البوتِ الذي يحاورُه هو،
 *   وإلّا وصلته من بوتٍ لم يبدأ معه محادثةً أصلًا فلا تصلُ. وصاحبٌ لا معرّفَ تلغرامَ
 *   له لن يصلَه شيءٌ أبدًا فيُتخلّى عن صفِّه (dead).
 * الحالة: منفّذ فعلياً — 2026-09-06.
 * ينتمي إلى: application/dispute
 * يُستخدم من: apps/workers/src/jobs/deliver-notifications.ts
 * ملاحظات مستقبلية: نصُّ القرارِ يُبنى في طبقةِ البنيةِ بلغةِ صاحبِه لا هنا.
 */
import { isSupportResolution } from "../../domain/dispute/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { NotificationHandler } from "../notification/deliver-notification.ts";
import type { TicketOwnerNotifier } from "./resolve-dispute.ts";

/** مُرسِلُ كلِّ صنفٍ: بوتُ السائقِ لسائقٍ، وبوتُ الراكبِ لراكبٍ. */
export interface TicketOwnerNotifiers {
  readonly driver: TicketOwnerNotifier;
  readonly rider: TicketOwnerNotifier;
}

export function createDisputeResolutionHandler(
  notifiers: TicketOwnerNotifiers,
): NotificationHandler {
  return async (delivery) => {
    const telegramId = delivery.payload.owner_telegram_id;
    const action = delivery.payload.action;
    const language = delivery.payload.owner_language;
    const ownerKind = delivery.payload.owner_kind;
    if (
      typeof telegramId !== "string" ||
      telegramId === "" ||
      typeof action !== "string" ||
      !isSupportResolution(action) ||
      (ownerKind !== "driver" && ownerKind !== "rider")
    ) {
      // لا وجهةَ للتبليغِ أو قرارٌ لا يُفهَم أو صنفٌ لا مُرسِلَ له: أثرٌ لن يُقبلَ
      // أبدًا فلا يُعادُ أبدًا.
      return ok({ abandon: true, messageId: null, failure: null });
    }
    const notifier = ownerKind === "driver" ? notifiers.driver : notifiers.rider;
    const sent = await notifier.notifyResolution({
      telegramId,
      action,
      language: typeof language === "string" && language !== "" ? language : "ar",
    });
    return ok({
      abandon: false,
      messageId: sent.ok ? sent.value : null,
      failure: sent.ok ? null : sent.error.detail,
    });
  };
}
