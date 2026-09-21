/**
 * الغرض: معالجُ إشعارِ مآلِ البلاغِ للمُبلِّغِ (`PD-021`). حينَ يُغلقُ فريقُ
 *   الإسنادِ بلاغَ سلامةٍ بقرارٍ وسببٍ داخليٍّ، يُودَعُ صفٌّ في `notification_outbox`
 *   في معاملةِ الإغلاقِ نفسِها — حمولتُه القرارُ (`close`/`block_reporter`) لا
 *   السببُ الداخليُّ. والعاملُ يلتقطُه ويُغنيهِ بمحادثةِ المُبلِّغِ ولغتِهِ، فيُرسلُ
 *   النصَّ العامَّ من القاموسِ: «تمَّت مراجعةُ بلاغكَ وإغلاقُه» لا «حُظرَ حسابُكَ
 *   بسببِ بلاغٍ كاذبٍ». فالسببُ الداخليُّ يُختزَنُ للمراجعةِ ولا يَبرزُ للعلنِ.
 * الحالة: منفّذ فعلياً — 2026-09-21، البند `PD-021`.
 * ينتمي إلى: application/safety
 * يُستخدم من: apps/workers/src/container.ts (عاملُ صندوقِ الصادرِ)
 * ملاحظات مستقبلية: لا شيءَ — الإشعارُ عامٌّ بلا أزرارٍ، فلا فعلَ ينتظرُ موافقةً.
 */
import type { Result } from "../../shared/result/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { NotificationHandler } from "../notification/deliver-notification.ts";
import type { PortFailureError } from "../ports/index.ts";

/** ما يحتاجُه النصُّ العامُّ ولا شيءَ سواه. */
export interface SafetyResolutionNotice {
  readonly chatId: string;
  readonly language: string;
  readonly decision: "close" | "block_reporter";
}

export interface SafetyResolutionMessenger {
  /** يُخبِرُ المُبلِّغَ بمآلِ بلاغِهِ — بلا أزرارٍ، فلا فعلَ ينتظرُ موافقةً. */
  sendResolution(notice: SafetyResolutionNotice): Promise<Result<string | null, PortFailureError>>;
}

/**
 * قراءةُ الإشعارِ من الحمولةِ. الرجوعُ بـnull يعني أنَّ الصفَّ لن يُقبلَ أبدًا:
 * مُبلِّغٌ لا محادثةَ له لحظةَ الالتقاطِ — حُذِفَ حسابُه أو لم يُوجَد — والإعادةُ
 * في هذا الحالِ تكرارٌ بلا رجاءِ نجاحٍ.
 */
function readNotice(payload: Readonly<Record<string, unknown>>): SafetyResolutionNotice | null {
  const chatId = payload.chat_id;
  const language = payload.language;
  const decision = payload.decision;
  if (typeof chatId !== "string" || chatId === "") return null;
  if (decision !== "close" && decision !== "block_reporter") return null;
  return {
    chatId,
    language: typeof language === "string" && language !== "" ? language : "ar",
    decision,
  };
}

export function createSafetyResolutionClosedHandler(
  messenger: SafetyResolutionMessenger,
): NotificationHandler {
  return async (delivery) => {
    const notice = readNotice(delivery.payload);
    if (notice === null) return ok({ abandon: true, messageId: null, failure: null });
    const sent = await messenger.sendResolution(notice);
    return ok({
      abandon: false,
      messageId: sent.ok ? sent.value : null,
      failure: sent.ok ? null : sent.error.detail,
    });
  };
}
