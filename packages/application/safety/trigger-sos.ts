/**
 * الغرض: تسجيل SOS من الراكب أو السائق قبل أي اتصال خارجي.
 * الحالة: منفّذ فعلياً في 2026-08-13؛ كان هيكلاً. وعُزِلَ مسارُ استقبالِه في
 *   2026-09-10 (`F8-05`). القرار: RPC واحد يثبت ملكية الطلب، يقفل نافذة المنع،
 *   وينشئ incident+outbox في معاملة واحدة، لأن تيليجرام قد يفشل ولا يجوز أن
 *   يصبح فشله فقداناً لنداء الطوارئ.
 * ينتمي إلى: application/safety
 * يستخدمه: حوارا الراكب والسائق في apps/gateway.
 * الحاكم: docs/adr/0077-sos-intake-resolves-its-own-order.md
 * ملاحظات مستقبلية: لا تضف اتصالات تيليجرام هنا؛ outbox العامل هو حدّ الموثوقية.
 *   ولا تضف `await` قبل هذا النداء في مسار الاستقبال: حاجزُ
 *   `scripts/check-sos-intake-isolation.ts` يُسقِطُ البناءَ.
 */

import type { SafetyIncidentReason } from "../../domain/safety/value-objects.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import type { SafetyRole, TriggerSosPort } from "./ports.ts";

/**
 * `F8-05` — لا طلبَ قائمَ للمُبلِّغِ. رمزٌ مُصدَّرٌ لا نصٌّ مكتوبٌ في كلِّ حوارٍ:
 * المُنادي يُميِّزُ هذا وحدَه عن سائرِ الأخطاءِ ليقولَ «لا رحلةَ قائمةٌ» بدلَ
 * «حدثَ عطلٌ»، ومقارنةُ نصٍّ حرفيٍّ في موضعَين تنشقُّ عندَ أوّلِ تحريرٍ.
 */
export const SOS_NO_ACTIVE_ORDER = "NO_ACTIVE_ORDER" as const;

export class TriggerSosError {
  readonly code = "TRIGGER_SOS_REJECTED" as const;
  constructor(readonly detail: string) {}
  /** هل الرفضُ سببُه أنَّه لا رحلةَ للمُبلِّغِ — لا عطلٌ ولا منعٌ؟ */
  get isNoActiveOrder(): boolean {
    return this.detail === SOS_NO_ACTIVE_ORDER;
  }
}
export interface TriggerSosInput {
  /**
   * `null` = **حُلَّ الطلبَ القائمَ للمُبلِّغِ في القاعدةِ** (`ADR-0077`).
   *
   * وهوَ ما يُمرِّرُه مسارُ الاستقبالِ دائماً: تمريرُ مُعرِّفٍ يقتضي قراءةً قبلَ
   * النداءِ — وإخفاقُها كانَ يُسقِطُ الاستغاثةَ — أو ثقةً في بياناتِ زرٍّ قد
   * تُزوَّرُ وقد تشيرَ إلى رحلةِ الأمسِ. ويبقى قبولُ المُعرِّفِ الصريحِ لمن
   * يملكُه أصلاً بلا قراءةٍ زائدةٍ.
   */
  readonly orderId: string | null;
  readonly actorTelegramId: string;
  readonly reporterRole: SafetyRole;
  /**
   * جنسُ البلاغِ (`PD-020` · `ADR 0159`) — يُمرَّرُ كما هو إلى الحاكمِ،
   * ولا قيمةَ افتراضيّةً ههنا: الطبقةُ التي تَندُبُ تعرفُ جنسَ ندائِها، وافتراضٌ
   * ههنا كانَ سيموّهُ نداءً بجنسِ آخرَ.
   */
  readonly reason: SafetyIncidentReason;
}
export interface TriggerSosDeps {
  readonly incidents: TriggerSosPort;
}
export interface TriggerSosReport {
  readonly incidentId: string;
  readonly created: boolean;
}

export async function triggerSos(
  input: TriggerSosInput,
  deps: TriggerSosDeps,
): Promise<Result<TriggerSosReport, TriggerSosError | PortFailureError>> {
  const triggered = await deps.incidents.trigger(input);
  if (!triggered.ok) return triggered;
  if (triggered.value.incidentId === null) return err(new TriggerSosError(triggered.value.error));
  return ok({ incidentId: triggered.value.incidentId, created: triggered.value.created });
}
