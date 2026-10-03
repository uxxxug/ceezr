/**
 * الغرض: رسالتا صاحبِ الطلبِ العالقِ على تيليجرام: «طلبُك في دائرةٍ أوسعَ» و«لم نجد
 *   سائقاً». تُرسَلانِ ببوتِ الراكبِ حصراً — إرسالُهما ببوتِ السائقِ يفشلُ بـ403 لأنَّ
 *   صاحبَ الطلبِ لم يفتح محادثةً معَه قطّ، وهو فشلٌ صامتٌ لا يظهرُ في سجلٍّ مُراقَبٍ.
 *   ولا حرفَ مكتوبٌ هنا: كلُّ نصٍّ من القاموسِ بلغةِ صاحبِه، ومعرّفُ المحادثةِ يأتي
 *   في الحمولةِ كما قرأتها القاعدةُ حيّةً لا مُخمَّناً.
 * الحالة: منفّذ فعلياً — 2026-09-06.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: apps/workers/src/container.ts (عاملُ صندوقِ الصادرِ)
 * ملاحظات مستقبلية: زرُّ «تمديدُ الانتظارِ» يُضافُ هنا حينَ يُقرَّرُ في التوجيهِ.
 */

import type {
  UnmatchedRiderMessenger,
  UnmatchedRiderNotice,
} from "../../application/dispatch/deliver-unmatched-notification.ts";
import { t } from "../../shared/i18n/index.ts";
import { guard } from "../db/client.ts";
import type { IdentifyingSender } from "./telegram-negotiation-notifier.ts";

/**
 * اسمُ زرِّ الإلغاءِ يُقرأُ من مفتاحِه لا يُكتبُ في النصِّ: البندُ 6.3 كان يقولُ
 * «أرسل ‎/cancel» وللإلغاءِ زرٌّ في القائمةِ منذ البندِ 2.1، ومن لا يجدُ سائقاً هو
 * أسوأُ من يُطلَبُ منه أن يتعلّمَ أمراً مكتوباً. وقراءتُه من مفتاحِه تمنعُ أن يكذبَ
 * النصُّ يومَ يتغيّرُ اسمُ الزرِّ.
 */
function cancelParams(language: string, surface: UnmatchedSurface): Record<string, string> {
  const tr = t(language);
  const cancelButton = tr("menu.rider.cancel");
  /**
   * `MSG-AUDIT-01`: في وضعِ التطبيقِ لا زرَّ «إلغاء طلبي» في قائمةِ المحادثةِ (فيها الطوارئُ
   * واللغةُ وحدَهما)، فكانَ النصُّ يُحيلُ إلى زرٍّ لا وجودَ له. والإلغاءُ ثمَّ في التطبيقِ،
   * وزرُّ «وَصْلة» يُلحِقُه المُرسِلُ الملفوفُ بالرسالةِ نفسِها.
   */
  const cancelHint =
    surface === "miniapp"
      ? tr("rider.cancel_hint_miniapp")
      : tr("rider.cancel_hint_menu", { cancel_button: cancelButton });
  return { cancel_button: cancelButton, cancel_hint: cancelHint };
}

/** سطحُ البوتِ: يحكمُ أينَ يُقالُ للعميلِ إنَّه يُلغي طلبَه. */
export type UnmatchedSurface = "miniapp" | "chat";

export function createTelegramUnmatchedMessenger(
  riderSender: IdentifyingSender,
  options: { readonly surface?: UnmatchedSurface } = {},
): UnmatchedRiderMessenger {
  const surface = options.surface ?? "chat";
  return {
    sendWiderCircleOpened: (notice: UnmatchedRiderNotice) =>
      guard("notifier.widerCircleOpened", async () => {
        const tr = t(notice.language);
        const key =
          notice.service === "delivery"
            ? "rider.searching_wider_circle_delivery"
            : "rider.searching_wider_circle";
        return riderSender.sendReturningId(
          notice.chatId,
          tr(key, cancelParams(notice.language, surface)),
          null,
        );
      }),

    sendNoDriverFound: (notice: UnmatchedRiderNotice) =>
      guard("notifier.noDriverFound", async () => {
        const tr = t(notice.language);
        const key =
          notice.service === "delivery"
            ? "rider.no_driver_found_delivery"
            : "rider.no_driver_found";
        return riderSender.sendReturningId(
          notice.chatId,
          tr(key, cancelParams(notice.language, surface)),
          null,
        );
      }),
  };
}
