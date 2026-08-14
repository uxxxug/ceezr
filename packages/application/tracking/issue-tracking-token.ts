/**
 * الغرض: إصدارُ رابط تتبّعٍ حيّ قابلٍ للمشاركة لطلبٍ قائم — مشواراً كان أو توصيلاً
 *   أو طرداً. يُنادى تلقائياً عند قبول العرض، وبطلبٍ من زرّ «شارك موقعي الحي».
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14 (§4.2 من أمر الإطلاق التجاري).
 * ينتمي إلى: application/tracking
 * يُتوقع أن يستخدمه: packages/application/bots/rider-dialog.ts (الإصدار التلقائي
 *   وزرّ المشاركة)، وapps/gateway عند تركيب الحوار.
 * ملاحظات مستقبلية: لو طُلِب رابطٌ للسائق نفسه (يشارك مسارَه مع أهله) فالتغييرُ
 *   في القاعدة لا هنا: شرطُ الملكية في `issue_tracking_token` هو ما يُوسَّع.
 *
 * ## لا فرقَ بين المشوار والتوصيل والطرد — وهذا مقصود
 *
 * الطلبُ في هذا المستودع كيانٌ واحد (`orders.service`) لا ثلاثةَ جداول، فالرمزُ
 * يُصدَر لأيّ طلبٍ قائم بلا سؤالٍ عن نوعه. ولو فُرِّق هنا لكان تكراراً لتمييزٍ لا
 * وجودَ له في المخطّط، ولانكشف يوم يُضاف نوعُ خدمةٍ رابع فيُنسى في شرطٍ نصّيّ.
 *
 * ## الرابطُ يُبنى هنا لا في الحوار
 *
 * الحوارُ يُرسل نصّاً؛ ومن بنى الرابط في الحوار كان سيكرّر شكلَه في كلّ موضعٍ
 * يُرسله (القبول، زرّ المشاركة، إعادةُ الإصدار بعد الإلغاء)، فيختلف موضعٌ عن آخر
 * يوماً ما. والشكلُ واحد: `<الأساس>/track/<الرمز>`.
 *
 * ## التحقّق من الملكية ليس هنا
 *
 * ولا سطرَ واحد فيه: مَن يملك الطلب سؤالٌ تجيبه القاعدة في العبارة نفسها التي
 * تكتب الصفّ (القاعدة 0.5). ولو سُئلت هنا أوّلاً لبقيت نافذةٌ بين الجواب
 * والكتابة — وهي بالضبط ما تُلغيه الدوالّ الذرّية.
 */

import type { OrderId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type {
  IssueTokenRejection,
  TrackingTokenMintPort,
  TrackingTokenRpcPort,
} from "./tracking-token-ports.ts";

export interface IssueTrackingTokenInput {
  readonly orderId: OrderId;
  /** معرّفُ تلغرام لصاحب الطلب — لا يُؤخذ من مُدخَل المستخدم بل من التحديث نفسه. */
  readonly telegramId: number;
}

export interface IssueTrackingTokenDeps {
  readonly tokens: TrackingTokenRpcPort;
  readonly mint: TrackingTokenMintPort;
  /**
   * أساسُ الرابط العامّ (`TRACKING_TOKEN_BASE_URL`) بلا شرطةٍ في آخره أو معها —
   * يُشذَّب هنا مرّةً فلا يظهر `//track` لأنّ أحداً كتب الأساس بشرطة.
   */
  readonly baseUrl: string;
}

export interface IssuedTrackingLink {
  readonly token: string;
  readonly url: string;
  readonly expiresAt: Date;
}

export class IssueTrackingTokenError {
  readonly code = "ISSUE_TRACKING_TOKEN_FAILURE" as const;
  constructor(
    /** إمّا سببٌ سمّته القاعدة، أو `PORT_FAILURE` لعطلٍ تقنيّ. */
    readonly reason: IssueTokenRejection | "PORT_FAILURE",
    readonly detail: string,
  ) {}
}

/** يُبنى مرّةً واحدة هنا فلا يتكرّر شكلُ الرابط في كلّ موضعٍ يُرسله. */
export function trackingUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/track/${token}`;
}

export async function issueTrackingToken(
  input: IssueTrackingTokenInput,
  deps: IssueTrackingTokenDeps,
): Promise<Result<IssuedTrackingLink, IssueTrackingTokenError>> {
  const token = deps.mint.mint();
  const result = await deps.tokens.issue(input.orderId, input.telegramId, token);
  if (!result.ok) {
    return err(new IssueTrackingTokenError("PORT_FAILURE", result.error.detail));
  }
  if (!result.value.ok) {
    return err(new IssueTrackingTokenError(result.value.rejection, result.value.rejection));
  }
  const row = result.value.row;
  return ok({
    token: row.token,
    url: trackingUrl(deps.baseUrl, row.token),
    expiresAt: row.expiresAt,
  });
}
