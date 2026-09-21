/**
 * الغرض: حالاتُ استخدامِ مشاركةِ الرحلةِ من التطبيقِ المصغَّرِ (`F2-09` ·
 *   `SR-13`) — قراءةُ الحالِ والمعاينةِ، وإصدارُ رابطٍ، وإيقافُ المشاركةِ كلِّها.
 * الحالة: منفَّذٌ فعليّاً — البند `F2-09`. حكمُ CI **غيرُ مقروءٍ** (`B-CI-001`).
 * ينتمي إلى: packages/application/transport
 * يُستخدم من: `apps/gateway/src/routes/rides.ts`
 * يُتوقع أن يستخدمه لاحقاً: `F2-10` — بلاغُ الطوارئِ سيُصدِرُ رابطاً بالمسارِ
 *   نفسِه ولا يكتبُ إصداراً ثانياً.
 *
 * ## لماذا ثلاثةُ أغلفةٍ رقيقةٍ لا ثلاثةُ منطقٍ جديدٍ
 *
 * الإصدارُ والإلغاءُ **مبنيّانِ منذُ 2026-08-14** ويستعملُهما البوتانِ
 * (`issueTrackingToken` · `revokeOrderTrackingTokens`). والجديدُ ههنا **بابٌ
 * واحدٌ**: تحويلُ جلسةِ التطبيقِ المصغَّرِ إلى معرّفِ تلغرامَ، ثمّ النداءُ.
 * ولو نُسِخَ المنطقُ لَصارَ للمشاركةِ مسارانِ يفترقانِ يومَ يتغيَّرُ شرطُ
 * الملكيّةِ في القاعدةِ (القاعدة 0.6).
 *
 * ## ولماذا معرّفُ تلغرامَ يُقرأُ عدداً ويُرفَضُ ما ليسَ عدداً
 *
 * الجلسةُ تحملُه نصّاً، والمنفذُ القائمُ يأخذُه عدداً. وتحويلٌ صامتٌ بـ`Number`
 * يُمرِّرُ `NaN` إلى القاعدةِ فيصيرُ عطبُ نوعٍ في أعمقِ طبقةٍ. فيُفحَصُ ههنا
 * ويُعلَنُ `ACCOUNT_NOT_FOUND` — وهوَ الأصدقُ: جلسةٌ بمعرّفٍ لا يُقرأُ ليسَت
 * حساباً نعرفُه.
 *
 * ## وما لا تفعلُه هذه الحالاتُ عن قصدٍ
 *
 *   ــ **لا تُلغي رمزاً بعينِه**: الإيقافُ بمعرّفِ الرحلةِ يُلغي **الكلَّ**.
 *      ومَن أرادَ إبقاءَ رابطٍ وإلغاءَ آخرَ يحتاجُ أن يُميِّزَهما في الواجهةِ
 *      بشيءٍ يعرفُه — ولا شيءَ يعرفُه عنهما إلّا وقتُ الإصدارِ. فـ«أوقِفْ
 *      المشاركةَ» فعلٌ واحدٌ صريحٌ، **ووعدُه مُنجَزٌ كاملاً**، خيرٌ من قائمةِ
 *      خياراتٍ يظنُّ الضاغطُ أنّه أغلقَ بها كلَّ شيءٍ وقد أبقى باباً.
 *   ــ **لا تُرسِلُ الرابطَ**: لا مزوّدَ رسائلَ في المستودَعِ؛ المشاركةُ من
 *      نظامِ الجهازِ، والخادمُ يُصدِرُ ولا يُوصِلُ.
 *   ــ **لا تعرفُ أجرةً ولا إيصالاً** (`ADR 0039` §٤ · `DEC-11`).
 */

import type { OrderId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import {
  type IssuedTrackingLink,
  type IssueTrackingTokenDeps,
  issueTrackingToken,
} from "../tracking/issue-tracking-token.ts";
import {
  type RevokeTrackingTokenDeps,
  revokeOrderTrackingTokens,
} from "../tracking/revoke-tracking-token.ts";
import { type RequestRidePublicErrorCode, rideStoreErrorFrom } from "./request-ride.ts";
import type { RideShareReader, RideShareVerdict } from "./ride-share-ports.ts";

/**
 * أخطاءُ سطحِ المشاركةِ. تُزادُ ثلاثةُ رموزٍ على رموزِ الطلبِ العامّةِ، **وكلُّها
 * تُترجَمُ في الواجهةِ** — فلا رمزَ يصلُ المستخدمَ بلا نصٍّ.
 */
export type RideSharePublicErrorCode =
  | RequestRidePublicErrorCode
  /** الميزةُ مُطفأةٌ صريحاً: لا `TRACKING_TOKEN_BASE_URL` مضبوطٌ. */
  | "SHARING_NOT_CONFIGURED";

/**
 * رفضُ الإصدارِ. **يُنشَرُ `200` بـ`issued:false`** كما في بقيّةِ مساراتِ
 * الرحلةِ: الطلبُ سليمٌ والجلسةُ سليمةٌ، والحالةُ هيَ التي منعَت — وهذا **حكمٌ
 * مقروءٌ** لا عطبُ عميلٍ يُصلَحُ بإعادةِ المحاولةِ بصيغةٍ أخرى.
 */
export type StartRideShareRefusal =
  /** «ليست لكَ» و«غيرُ موجودةٍ» جوابٌ واحدٌ — الفرقُ يُخبِرُ المُجرِّبَ بوجودِها. */
  | "ORDER_NOT_FOUND"
  /** الرحلةُ ليست جاريةً — لا رابطَ لما انتهى. */
  | "RIDE_NOT_ACTIVE"
  /** تصادمُ رمزٍ — يُعادُ الإصدارُ بضغطةٍ، ولا يُخفى خلفَ «عطلٍ». */
  | "LINK_COLLISION";

export type StartRideShareOutcome =
  | { readonly issued: true; readonly link: IssuedTrackingLink }
  | { readonly issued: false; readonly refusal: StartRideShareRefusal };

function sessionErrorFrom(reason: string): RideSharePublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

interface SessionDeps {
  readonly sessions: MiniAppSessionReader;
  readonly now: () => Date;
}

/** معرّفُ تلغرامَ من الجلسةِ — نصّاً كما تحملُه، وعدداً كما يطلبُه المنفذُ. */
function readTelegramId(raw: string): number | null {
  if (!/^[0-9]{1,15}$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function openSession(
  deps: SessionDeps,
  accessToken: string | undefined,
): Promise<Result<{ readonly telegramUserId: string }, RideSharePublicErrorCode>> {
  if (accessToken === undefined || accessToken.length === 0) return err("SESSION_REQUIRED");
  const session = await deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(sessionErrorFrom(session.error.reason));
  return ok({ telegramUserId: session.value.telegramUserId });
}

// ---------------------------------------------------------------------------
// القراءةُ
// ---------------------------------------------------------------------------

export interface ReadRideShareDeps extends SessionDeps {
  readonly shares: RideShareReader;
}

export async function readRideShare(
  deps: ReadRideShareDeps,
  input: { readonly accessToken: string | undefined; readonly orderId: string },
): Promise<Result<RideShareVerdict, RideSharePublicErrorCode>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const read = await deps.shares.read({
    telegramUserId: session.value.telegramUserId,
    orderId: input.orderId,
  });
  if (!read.ok) return err(rideStoreErrorFrom(read.error));
  return ok(read.value);
}

// ---------------------------------------------------------------------------
// الإصدارُ
// ---------------------------------------------------------------------------

export interface StartRideShareDeps extends SessionDeps {
  /**
   * تبعيّاتُ الإصدارِ القائمةُ — **أو `undefined`** متى كانَ الأساسُ العامُّ غيرَ
   * مضبوطٍ. و`undefined` قرارُ مشغِّلٍ مُعلَنٌ يُترجَمُ `SHARING_NOT_CONFIGURED`،
   * لا حقلٌ منسيٌّ يُبنى معَه رابطٌ بأساسٍ مُخمَّنٍ.
   */
  readonly issuing: IssueTrackingTokenDeps | undefined;
}

export async function startRideShare(
  deps: StartRideShareDeps,
  input: { readonly accessToken: string | undefined; readonly orderId: string },
): Promise<Result<StartRideShareOutcome, RideSharePublicErrorCode>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);
  if (deps.issuing === undefined) return err("SHARING_NOT_CONFIGURED");

  const telegramId = readTelegramId(session.value.telegramUserId);
  if (telegramId === null) return err("ACCOUNT_NOT_FOUND");

  const issued = await issueTrackingToken(
    { orderId: input.orderId as OrderId, telegramId },
    deps.issuing,
  );
  if (issued.ok) return ok({ issued: true, link: issued.value });

  const reason = issued.error.reason;
  if (reason === "UNAUTHORIZED" || reason === "ORDER_NOT_FOUND") {
    return ok({ issued: false, refusal: "ORDER_NOT_FOUND" });
  }
  if (reason === "ORDER_NOT_ACTIVE") return ok({ issued: false, refusal: "RIDE_NOT_ACTIVE" });
  if (reason === "TOKEN_COLLISION") return ok({ issued: false, refusal: "LINK_COLLISION" });
  // `TOKEN_TOO_SHORT` و`PORT_FAILURE` **عطبُ خدمةٍ** لا حكمُ حالةٍ: يُعلَنانِ
  // `503` ولا يُقرآنِ «لا يجوزُ لكَ» فيُفسَّرانِ سياسةً وهُما عطلٌ.
  return err("RIDE_STORE_NOT_AVAILABLE");
}

// ---------------------------------------------------------------------------
// الإيقافُ
// ---------------------------------------------------------------------------

export interface StopRideShareDeps extends SessionDeps {
  readonly revoking: RevokeTrackingTokenDeps;
}

/**
 * يُعيدُ **عددَ** ما أُلغيَ لا `true`: الشاشةُ تُفرِّقُ «أوقفنا رابطَينِ» من
 * «لا رابطَ ساري أصلاً»، والفرقُ يراهُ الضاغطُ فلا يظنُّ أنَّ الزرَّ لم يعملْ.
 * **ولا يُميَّزُ «ليست لكَ» عن «لا رابطَ»**: القاعدةُ لا تُميِّزُهما بقصدٍ.
 */
export async function stopRideShare(
  deps: StopRideShareDeps,
  input: { readonly accessToken: string | undefined; readonly orderId: string },
): Promise<Result<number, RideSharePublicErrorCode>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const telegramId = readTelegramId(session.value.telegramUserId);
  if (telegramId === null) return err("ACCOUNT_NOT_FOUND");

  const revoked = await revokeOrderTrackingTokens(
    { orderId: input.orderId as OrderId, telegramId },
    deps.revoking,
  );
  if (!revoked.ok) return err("RIDE_STORE_NOT_AVAILABLE");
  return ok(revoked.value);
}
