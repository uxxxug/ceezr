/**
 * الغرض: إثباتُ أنَّ آلةَ حالاتِ المهمّةِ التشغيليّةِ **مغلقةٌ**: لا انتقالَ من
 *   حالةٍ نهائيّةٍ، ولا انتقالَ خارجَ الجدولِ، ولكلِّ انتقالٍ حدثُه المنصوصُ
 *   ودالّتُه في القاعدةِ. البند `W-4`/`W-5`.
 *
 *   والادّعاءُ المُختبَرُ ههنا **ليسَ** «الشيفرةُ تمنعُ الانتقالَ» — المنعُ في
 *   القاعدةِ ويُختبَرُ في `tests/integration/wasla-fulfillment-lifecycle.test.ts`
 *   على محرّكٍ حقيقيٍّ. المُختبَرُ ههنا أنَّ **الإعلانَ نفسَه** لا ثقبَ فيه: أنَّ
 *   جدولَ الانتقالاتِ لا يسمحُ بما لا ينبغي، وأنَّ حسابَ النتيجةِ لا يُلبِّسُ
 *   ملغىً بفاشلٍ، وأنَّ صيغةَ مفتاحِ منعِ التكرارِ واحدةٌ.
 *
 * الحالة: اختبار وحدة فعلي — لا يحتاج قاعدةً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  canTransition,
  isTerminal,
  JOB_TRANSITIONS,
  MOVE_EVENT_TYPES,
  nextState,
  OPERATIONAL_JOB_STATES,
  type OperationalJobState,
  outboxDedupKey,
  outcomeFor,
  TERMINAL_STATES,
  TRANSITIONS,
} from "../../packages/domain/wasla/operational-job.ts";

describe("آلةُ حالاتِ المهمّةِ التشغيليّةِ — W-4", () => {
  it("تُعلِنُ الحالاتَ الخمسَ التي يفهمُها CORE ولا سادسةَ", () => {
    expect([...OPERATIONAL_JOB_STATES]).toEqual([
      "coordinating",
      "assigned",
      "completed",
      "failed",
      "cancelled",
    ]);
  });

  it("لا انتقالَ من حالةٍ نهائيّةٍ ألبتّةَ — والنهائيُّ ثلاثٌ", () => {
    expect([...TERMINAL_STATES]).toEqual(["completed", "failed", "cancelled"]);
    for (const state of TERMINAL_STATES) {
      for (const transition of JOB_TRANSITIONS) {
        expect(canTransition(state, transition)).toBe(false);
        expect(nextState(state, transition)).toBeNull();
      }
    }
  });

  it("«قيدَ التنسيقِ» تقبلُ القبولَ والرفضَ والإلغاءَ لا الإتمامَ ولا الفشلَ", () => {
    expect(canTransition("coordinating", "accept")).toBe(true);
    expect(canTransition("coordinating", "reject")).toBe(true);
    expect(canTransition("coordinating", "cancel")).toBe(true);
    // الإتمامُ من «قيدَ التنسيقِ» هوَ بعينِه «إعلانُ نجاحٍ قبلَ الإسنادِ».
    expect(canTransition("coordinating", "complete")).toBe(false);
    expect(canTransition("coordinating", "fail")).toBe(false);
  });

  it("«المُسندُ» يقبلُ الإتمامَ والفشلَ والإلغاءَ لا القبولَ ولا الرفضَ", () => {
    expect(canTransition("assigned", "complete")).toBe(true);
    expect(canTransition("assigned", "fail")).toBe(true);
    expect(canTransition("assigned", "cancel")).toBe(true);
    expect(canTransition("assigned", "accept")).toBe(false);
    expect(canTransition("assigned", "reject")).toBe(false);
  });

  it("كلُّ انتقالٍ مقصدُه حالةٌ معلنةٌ، ومصادرُه حالاتٌ معلنةٌ", () => {
    const known = new Set<string>(OPERATIONAL_JOB_STATES);
    for (const [name, spec] of Object.entries(TRANSITIONS)) {
      expect(known.has(spec.to), `مقصدُ ${name}`).toBe(true);
      expect(spec.from.length, `مصادرُ ${name}`).toBeGreaterThan(0);
      for (const from of spec.from) expect(known.has(from), `مصدرُ ${name}: ${from}`).toBe(true);
    }
  });

  it("مرحلةُ الفشلِ مُصرَّحةٌ حيثُ المقصدُ فاشلٌ، ومعدومةٌ حيثُ ليسَ", () => {
    for (const [name, spec] of Object.entries(TRANSITIONS)) {
      if (spec.to === "failed") {
        expect(spec.failureStage, `مرحلةُ فشلِ ${name}`).not.toBeNull();
      } else {
        expect(spec.failureStage, `${name} ليسَ فاشلاً فلا مرحلةَ له`).toBeNull();
      }
    }
    expect(TRANSITIONS.reject.failureStage).toBe("rejected");
    expect(TRANSITIONS.fail.failureStage).toBe("execution");
  });

  it("الرفضُ يُصدِرُ حدثَ رفضٍ، وفشلُ التنفيذِ يُصدِرُ حدثَ إتمامٍ بنتيجةِ فشلٍ", () => {
    expect(TRANSITIONS.reject.emits).toBe("move.job.rejected");
    expect(TRANSITIONS.fail.emits).toBe("move.job.completed");
    expect(TRANSITIONS.complete.emits).toBe("move.job.completed");
    expect(TRANSITIONS.accept.emits).toBe("move.job.accepted");
  });

  it("الإلغاءُ لا يُصدِرُ حدثاً — CORE هوَ من ألغى ولا حدثَ إلغاءٍ من MOVE في عقودِه", () => {
    expect(TRANSITIONS.cancel.emits).toBeNull();
    expect(MOVE_EVENT_TYPES).not.toContain("move.job.cancelled" as never);
  });

  it("كلُّ حدثٍ صادرٍ من الجدولِ هوَ نوعٌ معلنٌ لا نصٌّ حرٌّ", () => {
    const known = new Set<string>(MOVE_EVENT_TYPES);
    for (const spec of Object.values(TRANSITIONS)) {
      if (spec.emits !== null) expect(known.has(spec.emits)).toBe(true);
    }
  });

  it("النتيجةُ المُبلَّغةُ: تمَّ لِـcompleted، فشِلَ لِـfailed، ولا شيءَ للملغى", () => {
    expect(outcomeFor("completed")).toBe("completed");
    expect(outcomeFor("failed")).toBe("failed");
    expect(outcomeFor("cancelled")).toBeNull();
    expect(outcomeFor("coordinating")).toBeNull();
    expect(outcomeFor("assigned")).toBeNull();
  });

  it("`isTerminal` تُطابِقُ قائمةَ النهائيِّ ولا تُخالِفُها في حالةٍ واحدةٍ", () => {
    for (const state of OPERATIONAL_JOB_STATES) {
      expect(isTerminal(state)).toBe(TERMINAL_STATES.includes(state));
    }
  });

  it("مفتاحُ منعِ التكرارِ نوعٌ ثمَّ نقطتانِ ثمَّ المعرّفُ — بلا مسافةٍ ولا تبديلٍ", () => {
    expect(outboxDedupKey("move.job.accepted", "abc")).toBe("move.job.accepted:abc");
    // المفتاحُ يُميِّزُ النوعَ: مهمّةٌ واحدةٌ لها قبولٌ وإتمامٌ، فلو تساوى
    // المفتاحانِ لَحُجِبَ الثاني وظُنَّ مكرَّراً.
    expect(outboxDedupKey("move.job.completed", "abc")).not.toBe(
      outboxDedupKey("move.job.accepted", "abc"),
    );
  });

  it("جدولُ الانتقالاتِ يُغطّي كلَّ اسمٍ معلنٍ ولا يزيدُ عليه", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...JOB_TRANSITIONS].sort());
  });

  it("لا حالةَ معلنةً غيرَ مذكورةٍ في الجدولِ مصدراً أو مقصداً — فلا حالةَ ميتةً", () => {
    const touched = new Set<OperationalJobState>();
    for (const spec of Object.values(TRANSITIONS)) {
      touched.add(spec.to);
      for (const from of spec.from) touched.add(from);
    }
    for (const state of OPERATIONAL_JOB_STATES) expect(touched.has(state)).toBe(true);
  });
});
