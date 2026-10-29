/**
 * الغرض: قياسُ دوالِّ عدّادِ الصيانةِ الخلفيّةِ (`maintenanceJobsBetween` ·
 *   `maintenanceJobsRan`) بنصوصٍ مزروعةٍ — فرقُ حدَّينِ يكشفُ ما دخلَ نافذةَ
 *   القياسِ من مهامَّ (`BUG-017`)، وأيُّ انحرافٍ عن الصفرِ — حتى السالبَ — يُبطلُ
 *   القياسَ، فالعدّاداتُ لا تعودُ إلى الوراءِ إلا بإعادةِ ضبطِها وسطَه.
 * الحالة: مُختبَرٌ — بوّابةُ CI.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وخطوةُ «تحقّق» في CI.
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تعديلٍ على منطقِ الكشفِ عن تلوّثِ نافذةِ الصمودِ.
 * الحاكم: docs/evidence/correctness/BUG-017-20260919.md
 *
 * ## وما لا يقيسُه هذا الملفُّ عن قصدٍ
 * ــ **لا يُشغِّلُ اختبارَ الصمودَ**: ذاكَ على PostgreSQL حقيقيٍّ في `test:e2e`.
 * ــ **لا يقيسُ صدقَ العدّاداتِ نفسِها**: ذاكَ حكمُ `pg_stat_user_tables`.
 */

import { describe, expect, it } from "bun:test";
import {
  type MaintenanceJobs,
  maintenanceJobsBetween,
  maintenanceJobsRan,
} from "../support/engine-work.ts";

const jobs = (autovacuumCount: number, autoanalyzeCount: number): MaintenanceJobs => ({
  autovacuumCount: BigInt(autovacuumCount),
  autoanalyzeCount: BigInt(autoanalyzeCount),
});

describe("عدّادُ الصيانةِ الخلفيّةِ — فرقُ الحدَّينِ يُقرأُ لا يُخمَّنْ", () => {
  it("١) نافذةٌ ساكنةٌ: لا فرقَ ولا مهامَّ — القياسُ يخصُّ الشيفرةَ وحدَها", () => {
    const before = jobs(12, 40);
    const diff = maintenanceJobsBetween(before, jobs(12, 40));
    expect(diff).toEqual(jobs(0, 0));
    expect(maintenanceJobsRan(diff)).toBe(false);
  });

  it("٢) مهمّةُ autovacuum دخلتِ النافذةَ: الفرقُ يلتقطُها عدّاداً لا احتمالاً", () => {
    const diff = maintenanceJobsBetween(jobs(12, 40), jobs(14, 40));
    expect(diff).toEqual(jobs(2, 0));
    expect(maintenanceJobsRan(diff)).toBe(true);
  });

  it("٣) مهمّةُ autoanalyze دخلتِ النافذةَ: تُلتقطُ وحدَها فلا يُفلتَ أحدُ العدّادَينِ", () => {
    const diff = maintenanceJobsBetween(jobs(12, 40), jobs(12, 41));
    expect(diff).toEqual(jobs(0, 1));
    expect(maintenanceJobsRan(diff)).toBe(true);
  });

  it("٤) عدّادٌ عادَ إلى الوراءِ (إعادةُ ضبطٍ وسطَ القياسِ): انحرافٌ يُبطلُ القياسَ لا يمرّ", () => {
    const diff = maintenanceJobsBetween(jobs(12, 40), jobs(0, 0));
    expect(diff).toEqual(jobs(-12, -40));
    expect(maintenanceJobsRan(diff)).toBe(true);
  });

  it("٥) العدّادانِ مستقلّانِ: صفرٌ في أحدهما لا يُخفيَ دخولَ الآخرِ", () => {
    expect(maintenanceJobsRan(jobs(0, 0))).toBe(false);
    expect(maintenanceJobsRan(jobs(1, 0))).toBe(true);
    expect(maintenanceJobsRan(jobs(0, 1))).toBe(true);
  });
});
