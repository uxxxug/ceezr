/**
 * الغرض: حالتا استخدامِ سطحِ الاستغاثةِ من التطبيقِ المصغَّرِ (`F2-10` ·
 *   `SR-14`) — قراءةُ الحكمِ قبلَ العرضِ، وتقييدُ البلاغِ عندَ الضغطِ.
 * الحالة: منفَّذٌ فعليّاً — البند `F2-10`.
 * ينتمي إلى: packages/application/safety
 * يُستخدم من: `apps/gateway/src/routes/safety.ts`
 * يُتوقع أن يستخدمه لاحقاً: سطحُ السائقِ في التطبيقِ المصغَّرِ — الدورُ مُعامِلٌ
 *   ههنا لا فرعٌ، فلا سطرَ يُزادُ في هذه الطبقةِ حينَ يُبنى.
 * الحاكم: docs/adr/0111-sos-surface-is-a-judged-card-not-a-button.md
 *         و`docs/adr/0077-sos-intake-resolves-its-own-order.md` لمسارِ الضغطِ.
 *
 * ## `requestMiniAppSos` **موضعُ استقبالٍ ثالثٌ** محروسٌ بالحاجزِ نفسِه
 *
 * `scripts/check-sos-intake-isolation.ts` يعدُّها من `INTAKE_SITES`، فيلزمُها ما
 * يلزمُ أختَيها في البوتَينِ حرفاً: **انتظارٌ واحدٌ** على `triggerSos`، و`orderId:
 * null` حرفاً في الحِملِ، ولا قارئَ من القراءاتِ المحظورةِ. ولذلكَ قراءةُ
 * الجلسةِ ههنا **متزامنةٌ** (`sessions.read` لا تُنتظَرُ): كلُّ انتظارٍ يُوضَعُ
 * فوقَ سطرِ النداءِ يصيرُ شرطاً لوصولِ الاستغاثةِ، وإخفاقُه إسقاطٌ لها.
 *
 * **ولا تُقرأُ حالُ السطحِ قبلَ الضغطِ**: الضغطُ لا يسألُ `sos_surface_state`
 * أبداً. الحَكَمُ للعرضِ، والحاكمُ للضغطِ — ولو استُشيرَ الحَكَمُ عندَ الضغطِ
 * لَصارَ انتظاراً ثانياً يُسقِطُ النداءَ إن أخفقَ، ولَصارَ حكمُه على لحظةٍ
 * تسبقُ الكتابةَ فلا يضمنُ شيئاً.
 *
 * ## ولماذا رفضُ الحاكمِ يُنشَرُ رمزاً لا «حدثَ عطلٌ»
 *
 * `NO_ACTIVE_ORDER` جوابٌ صحيحٌ عن سؤالٍ صحيحٍ: انتهت نافذتُكَ. و«حدثَ عطلٌ»
 * تدفعُ إلى إعادةِ الضغطِ مرّاتٍ في لحظةِ خوفٍ بلا أملٍ في جوابٍ مختلفٍ.
 *
 * ## وما لا تفعلُه هذه الحالاتُ عن قصدٍ
 *
 *   ــ **لا تتّصلُ بأحدٍ ولا تنتظرُ تسليماً**: الإيداعُ في الصندوقِ الموحَّدِ
 *      حدُّ المسؤوليّةِ (§٧: من الضغطةِ إلى السجلِّ الدائمِ p99 ≤ 500ms).
 *   ــ **لا تُصنِّفُ الحادثَ ولا تُغلِقُه**: الإغلاقُ سطحُ دعمٍ لا سطحُ راكبٍ.
 *   ــ **لا تعرفُ هاتفاً ولا رقمَ طوارئٍ** — والإفصاحُ يقولُ ذلكَ صراحةً.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import type { SafetyRole } from "./ports.ts";
import type { SosSurfaceReader, SosSurfaceVerdict } from "./sos-surface-ports.ts";
import { type TriggerSosDeps, TriggerSosError, triggerSos } from "./trigger-sos.ts";

/**
 * أخطاءُ سطحِ الاستغاثةِ — **كلُّها تُترجَمُ في الواجهةِ**، فلا رمزَ يصلُ
 * المستخدمَ بلا نصٍّ.
 */
export type SosSurfacePublicErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_EXPIRED"
  | "SESSION_INVALID"
  | "SESSION_NOT_AVAILABLE"
  | "ACCOUNT_NOT_FOUND"
  | "SAFETY_STORE_NOT_AVAILABLE";

/**
 * رفضُ الضغطةِ. **يُنشَرُ `200` بـ`accepted:false`**: الطلبُ سليمٌ والجلسةُ
 * سليمةٌ، والحالةُ هيَ التي منعَت — وهذا حكمٌ مقروءٌ لا عطبٌ يُعادُ.
 */
export type TriggerSosRefusal =
  /** لا رحلةَ قائمةٌ ولا رحلةَ انتهت ضمنَ النافذةِ. */
  | "NO_ACTIVE_ORDER"
  /** مدينةُ الرحلةِ بلا قروبِ تصعيدٍ — نقصُ تهيئةٍ يُعلَنُ ولا يُخفى عطلاً. */
  | "ESCALATION_GROUP_MISSING"
  /** إعدادُ نافذةِ منعِ التكرارِ غائبٌ. */
  | "SOS_DEDUP_SETTING_MISSING"
  /** الحسابُ محجوبٌ، أو الطلبُ ليسَ للمُبلِّغِ — حكمُ منصّةٍ لا عطبٌ. */
  | "NOT_ALLOWED";

export type TriggerSosOutcome =
  | { readonly accepted: true; readonly incidentId: string; readonly created: boolean }
  | { readonly accepted: false; readonly refusal: TriggerSosRefusal };

function sessionErrorFrom(reason: string): SosSurfacePublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

interface SessionDeps {
  readonly sessions: MiniAppSessionReader;
  readonly now: () => Date;
}

function openSession(
  deps: SessionDeps,
  accessToken: string | undefined,
): Result<{ readonly telegramUserId: string }, SosSurfacePublicErrorCode> {
  if (accessToken === undefined || accessToken.length === 0) return err("SESSION_REQUIRED");
  const session = deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(sessionErrorFrom(session.error.reason));
  return ok({ telegramUserId: session.value.telegramUserId });
}

// ---------------------------------------------------------------------------
// القراءةُ — الحَكَمُ قبلَ العرضِ
// ---------------------------------------------------------------------------

export interface ReadSosSurfaceDeps extends SessionDeps {
  readonly surface: SosSurfaceReader;
  /** الدورُ مُعامِلٌ مُركَّبٌ لا مقروءٌ من الطلبِ: سطحُ الراكبِ يُركَّبُ راكباً. */
  readonly role: SafetyRole;
}

export async function readSosSurface(
  deps: ReadSosSurfaceDeps,
  input: { readonly accessToken: string | undefined },
): Promise<Result<SosSurfaceVerdict, SosSurfacePublicErrorCode>> {
  const session = openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const read = await deps.surface.read({
    telegramUserId: session.value.telegramUserId,
    role: deps.role,
  });
  if (!read.ok) {
    return err(
      read.error.reason === "USER_NOT_FOUND" ? "ACCOUNT_NOT_FOUND" : "SAFETY_STORE_NOT_AVAILABLE",
    );
  }
  return ok(read.value);
}

// ---------------------------------------------------------------------------
// الضغطةُ — موضعُ استقبالٍ محروسٌ (`F8-05` · `ADR-0077`)
// ---------------------------------------------------------------------------

export interface RequestMiniAppSosDeps extends SessionDeps, TriggerSosDeps {
  readonly role: SafetyRole;
}

/**
 * **موضعُ الاستقبالِ الثالثُ.** انتظارٌ واحدٌ، على `triggerSos`، بحِملٍ فيه
 * `orderId: null` حرفاً. ولا تُزَدْ فوقَه قراءةٌ ولا تحقُّقٌ ولا سجلٌّ مُنتظَرٌ:
 * الحاجزُ يُسقِطُ البناءَ، والسببُ أنَّ كلَّ ما فوقَ هذا السطرِ يصيرُ شرطاً
 * لوصولِ نداءِ استغاثةٍ — ومن ضغطَ ولم يُجَب لا يفتحُ تذكرةً.
 */
export async function requestMiniAppSos(
  deps: RequestMiniAppSosDeps,
  input: { readonly accessToken: string | undefined },
): Promise<Result<TriggerSosOutcome, SosSurfacePublicErrorCode>> {
  const session = openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const triggered = await triggerSos(
    {
      orderId: null,
      actorTelegramId: session.value.telegramUserId,
      reporterRole: deps.role,
    },
    deps,
  );
  if (triggered.ok) {
    return ok({
      accepted: true,
      incidentId: triggered.value.incidentId,
      created: triggered.value.created,
    });
  }
  if (triggered.error instanceof TriggerSosError) {
    const refusal = refusalFrom(triggered.error.detail);
    if (refusal !== null) return ok({ accepted: false, refusal });
    if (triggered.error.detail === "ACTOR_NOT_FOUND") return err("ACCOUNT_NOT_FOUND");
    // رمزٌ لا يُعرَفُ **لا يُطوى** في رفضٍ مطمئنٍّ: رفضٌ مخترَعٌ يُقرأُ
    // سياسةً مُقرَّرةً وهوَ عطبٌ لا يراهُ أحدٌ. فيُعلَنُ `503` ويُرى.
    return err("SAFETY_STORE_NOT_AVAILABLE");
  }
  return err("SAFETY_STORE_NOT_AVAILABLE");
}

/**
 * رمزُ القاعدةِ يُترجَمُ إلى رفضٍ مُصنَّفٍ، و`null` لما ليسَ رفضَ حالةٍ.
 *
 * **ورموزُ الملكيّةِ والحجبِ تُطوى في `NOT_ALLOWED` واحدٍ عن قصدٍ**: التفريقُ
 * بينَ «حسابُكَ محجوبٌ» و«الطلبُ ليسَ لكَ» يُخبِرُ المُجرِّبَ بحالِ حسابٍ ليسَ
 * حسابَه، ولا يُغيّرُ من فعلِ من يقرأُه شيئاً.
 */
function refusalFrom(detail: string): TriggerSosRefusal | null {
  if (detail === "NO_ACTIVE_ORDER") return "NO_ACTIVE_ORDER";
  if (detail === "ESCALATION_GROUP_MISSING") return "ESCALATION_GROUP_MISSING";
  if (detail === "SOS_DEDUP_SETTING_MISSING") return "SOS_DEDUP_SETTING_MISSING";
  if (
    detail === "ACTOR_BLOCKED" ||
    detail === "ORDER_NOT_OWNED" ||
    detail === "ORDER_NOT_ASSIGNED" ||
    detail === "ORDER_NOT_FOUND"
  ) {
    return "NOT_ALLOWED";
  }
  return null;
}
