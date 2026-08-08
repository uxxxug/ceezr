/**
 * الغرض: تصعيد فوري لبشري عند حالة حرجة، خارج دورة المعالجة العادية.
 * الحالة: **عقد فقط — لا تنفيذ.** محجوز صراحةً بأمر القسم 3، البند ب.2.
 * ينتمي إلى: packages/agent-core/brain
 * يُتوقع أن يستخدمه لاحقاً: brain/router.ts حين يُفتح هذا البند بأمر صريح
 * ملاحظات مستقبلية: عند مليار مستخدم يُوصَل بقناة تنبيه فورية من صنف PagerDuty،
 *   بمناوبات وتأكيد استلام وتصعيد ثانٍ عند عدم الردّ.
 *
 * ═══ لماذا لا تنفيذ اليوم ═══
 *
 * التصعيد ليس دالّة، بل **التزام تشغيلي**: لا معنى لتنبيهٍ يُرسَل إلى قناة لا
 * أحد مناوبٌ عليها، ولا لتصعيدٍ بلا تعريفٍ متَّفق عليه لِما يستحقّه ومن يستقبله
 * وماذا يفعل حين يستقبله. بناء الأنبوب قبل وجود المناوبة يُنتج تنبيهات تُتجاهَل،
 * وتنبيهٌ يُتجاهَل يُدرِّب الفريق على تجاهل التنبيهات — فيصير الضرر أكبر من
 * غيابه يوم يقع ما يستحقّ فعلاً.
 *
 * ولذلك `assessPriority` تُعيد `requiresHumanEscalation: false` **دائماً**: لا
 * يجوز أن تَعِد الطبقة بتصعيدٍ لا يقع. حين يُفتح هذا البند بأمر صريح، يتغيّر ذلك
 * السطر وهذا الملف معاً، لا أحدهما.
 */

import type { EventPayload, PriorityVerdict } from "../schemas.ts";

export interface EscalationRequest {
  readonly traceId: string;
  readonly event: EventPayload;
  readonly priority: PriorityVerdict;
  readonly reason: string;
}

export interface EscalationReceipt {
  readonly delivered: boolean;
  readonly channel: string | null;
  readonly acknowledgedBy: string | null;
}

/**
 * العقد المستقبلي. **لا يوجد تنفيذ واحد له في المستودع، وهذا مقصود.** أي وكيل
 * مستقبلي يقرأ هذا الملف: لا تُنفّذه لأنه موجود — وجوده حجزٌ لمكانه لا إذنٌ
 * بملئه. راجع `docs/adr/0012-isolated-agent-core-layer.md`.
 */
export type EscalationHandler = (request: EscalationRequest) => Promise<EscalationReceipt>;
