/**
 * الغرض: تنفيذ القفل الموزَّع بأقفال Postgres الاستشارية (advisory locks). الغاية:
 *   إن شُغِّلت خدمة العامل بأكثر من نسخة — وهذا ما يحدث على Render بمجرّد زيادة
 *   عدد النسخ أو أثناء نشرٍ متتالٍ تتعايش فيه النسخة القديمة والجديدة لحظات —
 *   فمهمّة واحدة لا تُنفَّذ مرّتين متزامنتين.
 * الحالة: منفّذ فعلياً — القسم 1، ومُختبَر باتصالين متزامنين على قاعدة حقيقية.
 * ينتمي إلى: infrastructure/scheduling
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/container.ts
 * ملاحظات مستقبلية: القفل الاستشاري يسقط تلقائياً بانقطاع الجلسة، وهذه أهمّ ميزة
 *   له على قفل بصفّ في جدول: نسخة عامل قُتلت لا تُخلّف قفلاً أبدياً يعطّل المهمّة.
 */

import type {
  DistributedLock,
  LockAttempt,
} from "../../application/scheduling/distributed-lock.ts";
import type { Sql } from "../db/client.ts";

/**
 * نطاق ثابت للمشروع في الحقل الأول من `pg_try_advisory_lock(int, int)`.
 * الصيغة ذات الحقلين مقصودة: قاعدة واحدة قد تشترك فيها أقفال من أدوات أخرى
 * (هجرات، أدوات نسخ احتياطي)، والنطاق يجعل تصادُم مفتاحٍ عارضٍ معها مستحيلاً
 * لا نادراً. القيمة هي 'WASH' بالـASCII، ذكرى لاسم وَصْلة.
 */
export const LOCK_NAMESPACE = 0x57_41_53_48;

/**
 * FNV-1a بـ32 بتّاً محسوباً في التطبيق لا في القاعدة.
 *
 * الاعتماد على `hashtext()` من Postgres كان أقصر، لكنه دالّة داخلية لا تضمن
 * استقرار مخرجها بين الإصدارات الرئيسة؛ ولو تغيّرت أثناء ترقية لكان نسختان من
 * العامل على إصدارين تحسبان مفتاحين مختلفين لنفس المهمّة — أي لا قفل أصلاً،
 * وهو أسوأ من غياب القفل لأنه غياب متخفٍّ في صورة حضور.
 */
export function lockKeyOf(name: string): number {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  // القاعدة تتوقّع int4 بإشارة، فالتحويل صريح لا ضمني.
  return hash | 0;
}

export function createAdvisoryLock(sql: Sql): DistributedLock {
  return {
    withLock: async <T>(key: string, run: () => Promise<T>): Promise<LockAttempt<T>> => {
      const objectId = lockKeyOf(key);

      // اتصال محجوز إلزامي: القفل الاستشاري ملكُ الجلسة، ومع تجمّع اتصالات قد
      // يُؤخذ القفل على اتصال ويُحرَّر على آخر — فلا يُحرَّر شيء ويبقى معلّقاً حتى
      // نهاية عمر الاتصال الأول. هذا خطأ لا يظهر في اختبار بنسخة واحدة.
      const reserved = await sql.reserve();

      try {
        const acquiredRows = await reserved<{ locked: boolean }[]>`
          select pg_try_advisory_lock(${LOCK_NAMESPACE}::int, ${objectId}::int) as locked
        `;
        if (acquiredRows[0]?.locked !== true) {
          return { acquired: false };
        }

        try {
          return { acquired: true, value: await run() };
        } finally {
          // التحرير في finally لا بعد النجاح: مهمّة رمت استثناءً يجب أن تُخلي
          // القفل لدورة قادمة، وإلّا عطّل عطلٌ عابرٌ المهمّة إلى نهاية عمر النسخة.
          await reserved`
            select pg_advisory_unlock(${LOCK_NAMESPACE}::int, ${objectId}::int)
          `;
        }
      } finally {
        reserved.release();
      }
    },
  };
}
