/**
 * الغرض: تحديد أهمية الحدث — هل يستحقّ معالجة الآن، وبأي ترتيب مقابل غيره.
 * الحالة: منفّذ فعلياً بقواعد صريحة — القسم 3، البند ب.2.
 * ينتمي إلى: packages/agent-core/brain
 * يُتوقع أن يستخدمه لاحقاً: brain/router.ts، وأي طابور أولوية مستقبلي
 * ملاحظات مستقبلية: عند مليار مستخدم يُستبدل هذا بنموذج مصنِّف مدرَّب على بيانات
 *   تشغيلية تاريخية (زمن الاستجابة الفعلي، معدّل التصعيد، كلفة التأخير). العقد
 *   الذي يعود به (`PriorityVerdict`) هو نفسه حينها — يتغيّر ما بداخل الدالة لا من
 *   يستدعيها.
 *
 * لماذا خريطة إعداد لا شجرة شروط في الكود: تغيير أولوية نوع حدث قرارٌ تشغيلي
 * يتّخذه من يُدير الدعم، لا تعديلٌ يستحقّ نشر كود. الخريطة أدناه صريحة ومقروءة،
 * والقيم منها تُقرأ بالاسم فلا تُخطئ صامتةً.
 */

import type { EventPayload, PriorityLevel, PriorityVerdict } from "../schemas.ts";
import { isPriorityLevel } from "../schemas.ts";
import priorityMap from "./priority-map.json" with { type: "json" };

interface PriorityRule {
  readonly level: string;
  readonly rationale: string;
}

interface PriorityMapShape {
  readonly defaultLevel: string;
  readonly byEventType: Readonly<Record<string, PriorityRule>>;
  /** كلمات في نصّ الحدث ترفع أولويته درجةً واحدة — لا درجتين. */
  readonly escalatingKeywords: readonly string[];
}

const map = priorityMap as PriorityMapShape;

const ORDER: readonly PriorityLevel[] = ["low", "normal", "high", "critical"];

/** يرفع درجةً واحدة فقط. الرفع درجتين بكلمةٍ واحدة يجعل كل شيء حرجاً فلا شيء حرجاً. */
function raiseOnce(level: PriorityLevel): PriorityLevel {
  const index = ORDER.indexOf(level);
  return ORDER[Math.min(index + 1, ORDER.length - 1)] ?? level;
}

function safeLevel(raw: string, fallback: PriorityLevel): PriorityLevel {
  return isPriorityLevel(raw) ? raw : fallback;
}

/**
 * يقرأ الأولوية من الخريطة، ثم يرفعها درجةً إن حمل النصّ كلمة تصعيد.
 *
 * **`requiresHumanEscalation` مُثبَّت على `false` اليوم** بصرف النظر عن الأولوية:
 * `brain/escalation.ts` عقدٌ بلا تنفيذ، وإعادة `true` من هنا كانت ستَعِد بتصعيدٍ
 * لا يقع — ووعدٌ لا يقع أسوأ من غياب الوعد، لأن أحداً سيبني عليه.
 */
export function assessPriority(event: EventPayload): PriorityVerdict {
  const fallbackLevel = safeLevel(map.defaultLevel, "normal");
  const rule = map.byEventType[event.eventType];

  if (rule === undefined) {
    return {
      level: fallbackLevel,
      rationale: `لا قاعدة أولوية للنوع ${event.eventType} — الافتراضي`,
      requiresHumanEscalation: false,
    };
  }

  const baseLevel = safeLevel(rule.level, fallbackLevel);
  const text = event.text.toLowerCase();
  const matched = map.escalatingKeywords.find((keyword) => text.includes(keyword.toLowerCase()));

  if (matched === undefined) {
    return { level: baseLevel, rationale: rule.rationale, requiresHumanEscalation: false };
  }

  const raised = raiseOnce(baseLevel);
  return {
    level: raised,
    rationale:
      raised === baseLevel
        ? `${rule.rationale} — ورد فيه «${matched}» وهو عند السقف أصلاً`
        : `${rule.rationale} — رُفع إلى ${raised} لورود «${matched}»`,
    requiresHumanEscalation: false,
  };
}
