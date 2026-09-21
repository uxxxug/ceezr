/**
 * الغرض: حالةُ استعمالٍ — قراءةُ تفاصيلِ رحلةٍ واحدةٍ وسجلِّ أحداثِها
 *   (البند `F2-08` · `SR-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-08`.
 * ينتمي إلى: packages/application/transport
 * يُستخدم من: `apps/gateway/src/routes/rides.ts` (`GET /v1/rides/:id/detail`)
 * يُتوقع أن يستخدمه لاحقاً: `F2-12` (تذكرةُ الدعمِ) تُرفِقُ سجلَّ الأحداثِ نفسَه
 *   بالتذكرةِ ولا تُعيدُ جمعَه.
 * ملاحظات مستقبلية: **لا إيصالَ ولا مبلغَ ولا خانةً لهما** قبلَ `DEC-11`.
 *
 * ## لماذا حالةٌ ثانيةٌ ولم تُوسَّعْ `readRideSummary`
 *
 * الملخَّصُ (`F2-07`) يُجيبُ عن **رحلةٍ انتهت**: مدّةٌ ووترٌ وحالةُ تقييمٍ،
 * ويرفضُ ما لم ينتهِ. والتفاصيلُ تُجيبُ عن **أيِّ رحلةٍ**: ماذا جرى ومتى، ولو
 * أُلغيَت في الدقيقةِ الأولى. فدمجُهما يعني دالّةً نصفُ حقولِها معدومٌ أبداً،
 * ويعني أنَّ رحلةً ملغاةً تُقرأُ عبرَ عقدٍ اسمُه «الملخَّصُ» فيُتوقَّعُ فيه
 * تقييمٌ لا يجوزُ.
 *
 * ## ولماذا لا يُحسَبُ ههنا شيءٌ من الأحداثِ
 *
 * سجلُّ الأحداثِ **مقروءٌ لا محسوبٌ**: كلُّ حدثٍ لهُ أثرٌ مكتوبٌ ومصدرٌ منشورٌ.
 * واشتقاقُ حدثٍ من حالةٍ (مثلاً: «مُلغاةٌ» ⇐ «أُلغيَت الآنَ») يُنتِجُ سطراً في
 * سجلٍّ لا سندَ له، وسجلٌّ بسطرٍ مُختلَقٍ لا يصلحُ شاهداً في نزاعٍ — وهوَ الغرضُ
 * الوحيدُ من وجودِه.
 *
 * ## وما لا تفعلُه هذه الحالةُ عن قصدٍ
 *
 *   ــ **لا تُعيدُ مدّةً ولا وترَ خطٍّ**: تلكَ حقولُ الملخَّصِ (القاعدة 0.6).
 *   ــ **لا ترسمُ مساراً ولا تطلبُ خريطةً** (`ADR 0007`).
 *   ــ **لا تُميِّزُ «ليست لكَ» عن «لا توجدُ»**: القاعدةُ تردُّ `ORDER_NOT_FOUND`
 *      للاثنتَينِ، وفرقُ الرمزَينِ **إثباتُ وجودٍ** لِمَن لا يملكُ.
 */

import { type RideOutcomeClass, rideOutcomeClassOf } from "../../domain/transport/ride-history.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import { type RequestRidePublicErrorCode, rideStoreErrorFrom } from "./request-ride.ts";
import type { RideDetailReader, RideDetailRefusal, RideDetailState } from "./ride-history-ports.ts";

export interface ReadRideDetailDeps {
  readonly sessions: MiniAppSessionReader;
  readonly details: RideDetailReader;
  readonly now: () => Date;
}

export interface RideDetailView {
  readonly state: RideDetailState;
  /** تصنيفُ الحالةِ للعرضِ — يُحسَبُ مرّةً ههنا لا في كلِّ سطحٍ. */
  readonly outcome: RideOutcomeClass;
}

export type ReadRideDetailResult =
  | { readonly found: true; readonly view: RideDetailView }
  | { readonly found: false; readonly refusal: RideDetailRefusal };

export async function readRideDetail(
  deps: ReadRideDetailDeps,
  input: { readonly accessToken: string | undefined; readonly orderId: string },
): Promise<Result<ReadRideDetailResult, RequestRidePublicErrorCode>> {
  if (input.accessToken === undefined || input.accessToken.length === 0) {
    return err("SESSION_REQUIRED");
  }
  const session = await deps.sessions.read(input.accessToken, deps.now().getTime());
  if (!session.ok) {
    const reason = session.error.reason;
    if (reason === "EXPIRED") return err("SESSION_EXPIRED");
    if (reason === "NOT_CONFIGURED") return err("SESSION_NOT_AVAILABLE");
    return err("SESSION_INVALID");
  }

  const read = await deps.details.read({
    telegramUserId: session.value.telegramUserId,
    orderId: input.orderId,
  });
  if (!read.ok) return err(rideStoreErrorFrom(read.error));

  const verdict = read.value;
  if (!verdict.found) return ok({ found: false, refusal: verdict.refusal });

  return ok({
    found: true,
    view: { state: verdict.state, outcome: rideOutcomeClassOf(verdict.state.status) },
  });
}
