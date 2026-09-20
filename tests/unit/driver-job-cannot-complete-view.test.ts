/**
 * الغرض: اختبارُ وحدةٍ لمفاتيحِ سردِ «تعذّرَ الإكمالُ» في نموذجِ عرضِ مَهمّةِ
 *   السائقِ (`PD-020`) — «استُقبِلَ البلاغُ» يُفصَلُ عن «اطّلعَ عليهِ الفريقُ»
 *   في نصوصِ الحالةِ، والقيمةُ المجهولةُ تُقالَ «يُتابَعُ» لا فراغاً.
 * الحالة: منفَّذٌ فعليّاً — البند `PD-020`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test`.
 * الحاكم: docs/adr/0159-safety-channel-entry-delivery-review-and-driver-cannot-complete.md
 */

import { describe, expect, it } from "bun:test";
import {
  cannotCompleteNarrativeKey,
  cannotCompleteRefusalKey,
} from "../../apps/miniapp/src/surfaces/driver/job/job-view.ts";

describe("cannotCompleteNarrativeKey", () => {
  it("الأطوارُ الأربعةُ تُخطَّطُ إلى نصوصِ السائقِ لا نصوصِ الراكبِ", () => {
    // أُنشِئَ ولم يُسلَّمْ بعدُ.
    expect(cannotCompleteNarrativeKey("open", "pending")).toBe(
      "driver.job.cannotComplete.delivery.pending",
    );
    // سُلِّمَ للفريقِ ولم يطَّلِعْ أحدٌ — «استُقبِلَ» وحدها.
    expect(cannotCompleteNarrativeKey("open", "delivered")).toBe(
      "driver.job.cannotComplete.delivery.delivered",
    );
    // المطالبةُ البشريّةُ قلبت «اطّلعَ».
    expect(cannotCompleteNarrativeKey("received", "delivered")).toBe(
      "driver.job.cannotComplete.status.received",
    );
    expect(cannotCompleteNarrativeKey("closed", "delivered")).toBe(
      "driver.job.cannotComplete.status.closed",
    );
  });

  it("قيمةٌ لا يعرفُها النطاقُ تُقالَ «يُتابَعُ» لا فراغاً ولا سراباً", () => {
    expect(cannotCompleteNarrativeKey("مجهول", "delivered")).toBe(
      "driver.job.cannotComplete.delivery.pending",
    );
    expect(cannotCompleteNarrativeKey("open", "مجهول")).toBe(
      "driver.job.cannotComplete.delivery.pending",
    );
  });
});

describe("cannotCompleteRefusalKey", () => {
  it("كلُّ رمزِ رفضٍ عامٍّ لهُ نصٌّ، والمجهولُ يُقالُ رفضاً لا سراباً", () => {
    expect(cannotCompleteRefusalKey("NOT_A_DRIVER")).toBe(
      "driver.job.cannotComplete.refusal.notAllowed",
    );
    expect(cannotCompleteRefusalKey("ACTOR_BLOCKED")).toBe(
      "driver.job.cannotComplete.refusal.notAllowed",
    );
    expect(cannotCompleteRefusalKey("JOB_NOT_FOUND")).toBe(
      "driver.job.cannotComplete.refusal.jobNotFound",
    );
    expect(cannotCompleteRefusalKey("CITY_NOT_READY")).toBe(
      "driver.job.cannotComplete.refusal.cityNotReady",
    );
    expect(cannotCompleteRefusalKey("REPORT_REJECTED")).toBe(
      "driver.job.cannotComplete.refusal.rejected",
    );
    expect(cannotCompleteRefusalKey("ليس رمزاً")).toBe("driver.job.cannotComplete.refusal.rejected");
  });
});
