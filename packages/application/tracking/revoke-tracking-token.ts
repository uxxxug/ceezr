/**
 * الغرض: إلغاءُ رابط تتبّعٍ فوراً بطلب مُصدِره — من شارك رابطاً ثمّ ندم يقطعه في
 *   ضغطةٍ واحدة، ويُصدر غيرَه إن أراد.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14 (§4.2 من أمر الإطلاق التجاري).
 * ينتمي إلى: application/tracking
 * يُتوقع أن يستخدمه: packages/application/bots/rider-dialog.ts (زرّ «إلغاء رابط
 *   التتبّع»)، ولوحةُ الإدارة يوم تحتاج قطعَ رابطٍ بطلب دعم.
 *
 * ## الإلغاء لا يُصدر بديلاً هنا
 *
 * الأمرُ يقول: زرٌّ يُلغي الرمز الحالي **ويُصدر رمزاً جديداً**. وهما فعلان لا فعل:
 * من ألغى لأنّ رابطاً وصل من لا يريد قد لا يريد رابطاً بديلاً في اللحظة نفسها،
 * ودمجُهما في دالّةٍ واحدة يجعل «الإلغاء» إصداراً ضمنياً لا يُرى في الكود.
 * فالتركيبُ في الحوار: يُلغي، ثمّ يسأل، ثمّ يُصدر — وكلُّ خطوةٍ ظاهرةٌ ومُختبَرة.
 *
 * ## سببٌ واحد لكلّ فشل — عن قصد
 *
 * القاعدة لا تفرّق بين «لا وجود» و«ليس لك» و«مُلغى سابقاً»، وهذه الطبقة لا
 * تستدرك عليها: التفريقُ يجعل الدالّة أداةَ استكشافٍ لمن يجرّب رموزاً. والمستخدم
 * الحقيقيّ لا يحتاج التمييز — رسالتُه واحدة: «لا رابطَ ساري لهذه الرحلة».
 */

import type { OrderId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { TrackingTokenRpcPort } from "./tracking-token-ports.ts";

export interface RevokeTrackingTokenInput {
  readonly token: string;
  /** معرّفُ تلغرام للمُلغي — لا يُقبل إلغاءٌ إلا من مُصدِر الرمز نفسه. */
  readonly telegramId: number;
}

export interface RevokeTrackingTokenDeps {
  readonly tokens: TrackingTokenRpcPort;
}

export class RevokeTrackingTokenError {
  readonly code = "REVOKE_TRACKING_TOKEN_FAILURE" as const;
  constructor(
    readonly reason: "NOT_REVOCABLE" | "PORT_FAILURE",
    readonly detail: string,
  ) {}
}

export async function revokeTrackingToken(
  input: RevokeTrackingTokenInput,
  deps: RevokeTrackingTokenDeps,
): Promise<Result<true, RevokeTrackingTokenError>> {
  const result = await deps.tokens.revoke(input.token, input.telegramId);
  if (!result.ok) {
    return err(new RevokeTrackingTokenError("PORT_FAILURE", result.error.detail));
  }
  if (!result.value) {
    return err(new RevokeTrackingTokenError("NOT_REVOCABLE", "TOKEN_NOT_REVOCABLE"));
  }
  return ok(true);
}

export interface RevokeOrderTrackingTokensInput {
  readonly orderId: OrderId;
  /** معرّفُ تلغرام لصاحب الطلب — من التحديث نفسه لا من نصٍّ يكتبه المستخدم. */
  readonly telegramId: number;
}

/**
 * إلغاءُ كلّ روابط الطلب السارية. تُعيد العددَ لا `true`: الحوارُ يُفرّق بين
 * «أُلغيت روابطك» و«لا رابطَ ساري أصلاً» — والفرقُ يراه المستخدم فلا يظنّ أنّ
 * الزرّ لم يعمل. ولا تُميّز «لست المالك» عن «لا رابط»: القاعدة لا تُميّزهما بقصد.
 */
export async function revokeOrderTrackingTokens(
  input: RevokeOrderTrackingTokensInput,
  deps: RevokeTrackingTokenDeps,
): Promise<Result<number, RevokeTrackingTokenError>> {
  const result = await deps.tokens.revokeForOrder(input.orderId, input.telegramId);
  if (!result.ok) {
    return err(new RevokeTrackingTokenError("PORT_FAILURE", result.error.detail));
  }
  return ok(result.value);
}
