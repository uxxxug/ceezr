/**
 * الغرض: هويّةُ العمليةِ المُعلَنةُ التي تُرافِق كلَّ دفعةِ مقاييسٍ إلى المُجمِّعِ
 *   المركزيِّ، وتُعرَض في `/metrics` كي لا تُقرَأ كشطةُ عمليةٍ واحدةٍ أرقامَ منصّةٍ.
 *   الشطرُ الأوّلُ من [ADR 0062](../../../docs/adr/0062-central-metric-aggregation-is-otlp-push-with-declared-process-identity.md) (`F5-07`/`SCL-006`).
 * الحالة: منفّذ فعلياً — طبقة المراقبة التشغيلية.
 * ينتمي إلى: packages/infrastructure/observability
 * يستخدمه: otlp-metrics.ts · central-metrics-export.ts · apps/gateway/src/index.ts
 * ملاحظات مستقبلية: يومَ يُنشَر عاملٌ في عمليةٍ مستقلّةٍ (`F5-04`) يُمرَّر له `role`
 *   الخاصُّ به من نقطةِ تشغيلِه — ولا يُستنتَج الدورُ من متغيّرِ بيئةٍ عامٍّ.
 *
 * ## لماذا مُعلَنةٌ لا مُستنتَجةٌ
 *
 * هذا هو الدرسُ نفسُه الذي كتبه [ADR 0051](../../../docs/adr/0051-process-topology-is-declared-not-inferred-from-session-store.md):
 * الطوبولوجيا تُعلَن ولا تُستنتَج من إشارةٍ جانبيّةٍ. والاستنتاجُ ههنا أخطرُ، لأنّ
 * الهويّةَ المُستنتَجةَ خاطئةً تُنتج **جمعاً خاطئاً** في المُجمِّعِ: عمليّتانِ بمعرِّفٍ
 * واحدٍ تكتب إحداهما فوقَ الأخرى فيهبط المجموعُ، وعمليّةٌ واحدةٌ بمعرِّفٍ متقلّبٍ
 * تُقرَأ أسطولاً. فالمعرِّفُ يُؤخَذ من المنصّةِ إن أعلنته، وإلّا وُلِّد **مرّةً واحدةً
 * لعمرِ العمليةِ** — والتقلّبُ عندَ إعادةِ الإقلاعِ مقصودٌ: هو تصفيرُ عدَّادٍ حقيقيٌّ
 * يجب أن يراه المُجمِّعُ، لا هبوطٌ يُخفى (ADR 0062 §٢-٨).
 */

import { randomUUID } from "node:crypto";

/** أدوارُ العملياتِ المعروفةُ — قائمةٌ مغلقةٌ لا نصٌّ حرٌّ، حتى لا يصير الدورُ وسماً مفتوحاً. */
export const PROCESS_ROLES = ["gateway", "worker", "admin"] as const;

export type ProcessRole = (typeof PROCESS_ROLES)[number];

export interface ProcessIdentity {
  /** اسمُ الخدمةِ المنطقيُّ — واحدٌ لكلِّ الأدوارِ: المنصّةُ واحدةٌ والأدوارُ فيها. */
  readonly serviceName: string;
  /** دورُ العمليةِ. */
  readonly role: ProcessRole;
  /** معرِّفُ نسخةِ العمليةِ — ثابتٌ لعمرِها، مختلفٌ بينَ عمليّتينِ. */
  readonly instanceId: string;
  /** بيئةُ النشرِ كما أعلنها المشغّلُ. */
  readonly environment: string;
}

/** اسمُ الخدمةِ ثابتٌ في الشيفرةِ: من جعله متغيّرَ بيئةٍ سمح بأسطولٍ يُسمّي نفسَه أسماءً. */
export const SERVICE_NAME = "waslah";

/** حينَ لا يُعلِن المشغّلُ بيئةً: لا يُخمَّن «production» — الخطأُ في هذا الاتّجاهِ يُلوِّث لوحةَ الإنتاج. */
export const UNKNOWN_ENVIRONMENT = "unknown";

/** مصدرُ القراءةِ — مُمرَّرٌ كي تكونَ الدالّةُ خالصةً في الاختبارِ بلا عبثٍ بالعمليةِ. */
export interface IdentitySource {
  readonly SERVICE_INSTANCE_ID?: string | undefined;
  readonly DEPLOYMENT_ENVIRONMENT?: string | undefined;
}

const trimmed = (value: string | undefined): string | null => {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
};

/**
 * يبني الهويّةَ. `generateId` مُمرَّرٌ لتُثبِت الاختباراتُ أنّ التوليدَ لا يقع إلّا
 * عندَ غيابِ إعلانِ المنصّةِ.
 */
export function buildProcessIdentity(
  role: ProcessRole,
  source: IdentitySource = process.env as IdentitySource,
  generateId: () => string = randomUUID,
): ProcessIdentity {
  return {
    serviceName: SERVICE_NAME,
    role,
    instanceId: trimmed(source.SERVICE_INSTANCE_ID) ?? generateId(),
    environment: trimmed(source.DEPLOYMENT_ENVIRONMENT) ?? UNKNOWN_ENVIRONMENT,
  };
}
