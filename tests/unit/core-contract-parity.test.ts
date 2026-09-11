/**
 * الغرض: إثباتُ أنَّ مُدقِّقَ المغلَّفِ يُنفِّذُ عقدَ CORE فعلاً، وأنَّ حاجزَ
 *   التطابقِ **يُخفِقُ عندَ الانفراطِ** لا يُصادِقُ على كلِّ شيءٍ. البند `W-5`.
 *
 *   والحاجزُ الأخضرُ على كلِّ إدخالٍ حاجزٌ معدومٌ (ح-5)؛ فههنا **تُشوَّهُ**
 *   المخطَّطاتُ والهجراتُ نسخاً في الذاكرةِ ويُتحقَّقُ أنَّ المقابلةَ ترصدُ كلَّ
 *   تشويهٍ: حقلٌ محذوفٌ، ومطلوبٌ مزيدٌ، ونوعٌ مغيَّرٌ، وقائمةُ قيمٍ موسَّعةٌ،
 *   و`additionalProperties` مفتوحٌ، وكلمةٌ لا يفهمُها المُدقِّقُ، ودالّةٌ مفقودةٌ،
 *   وحالةٌ مفقودةٌ، وصيغةُ مفتاحٍ مبدَّلةٌ.
 *
 * الحالة: اختبار وحدة فعلي — لا يحتاج قاعدةً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ENVELOPE_SPEC,
  PAYLOAD_SPECS,
  validateEnvelope,
  validateObject,
} from "../../packages/domain/wasla/event-envelope.ts";
import { compareObject, compareStateMachine } from "../../scripts/check-core-contract-parity.ts";

const W4 = readFileSync("supabase/migrations/20260911100000_w4_operational_jobs.sql", "utf8");
const W5 = readFileSync("supabase/migrations/20260911100100_w5_core_inbox_move_outbox.sql", "utf8");

function schema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`docs/contracts/core/${name}.schema.json`, "utf8")) as Record<
    string,
    unknown
  >;
}

/** نسخةٌ عميقةٌ — التشويهُ لا يمسُّ الملفَّ ولا يُسرِّبُ إلى اختبارٍ آخرَ. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const VALID_CREATED = {
  event_id: "11111111-1111-4111-8111-111111111111",
  event_type: "core.fulfillment.created",
  version: 1,
  producer: "wasla-core",
  occurred_at: "2026-09-11T10:00:00.000Z",
  correlation_id: "corr-1",
  causation_id: null,
  entity_type: "fulfillment",
  entity_id: "11111111-1111-4111-8111-111111111111",
  payload: {
    fulfillment_id: "11111111-1111-4111-8111-111111111111",
    organization_id: "22222222-2222-4222-8222-222222222222",
    order_reference: "order-1",
    requested_service: "delivery",
  },
} as const;

describe("مُدقِّقُ المغلَّفِ — تنفيذُ عقدِ CORE لا صورةٌ عنه", () => {
  it("يُمرِّرُ مغلَّفاً صحيحاً كاملاً", () => {
    expect(validateEnvelope(VALID_CREATED)).toEqual([]);
  });

  it("يرفضُ `causation_id` **الغائبَ** ويقبلُه `null` — الحضورُ مطلوبٌ والقيمةُ تجوزُ فراغاً", () => {
    const withoutKey = clone(VALID_CREATED) as Record<string, unknown>;
    delete withoutKey.causation_id;
    expect(validateEnvelope(withoutKey)).toContainEqual({
      path: "causation_id",
      problem: "حقلٌ مطلوبٌ غائبٌ",
    });
    expect(validateEnvelope({ ...clone(VALID_CREATED), causation_id: "prev" })).toEqual([]);
  });

  it("يرفضُ الحقلَ الزائدَ في المغلَّفِ وفي الحمولةِ — العقدُ مغلقٌ", () => {
    expect(validateEnvelope({ ...clone(VALID_CREATED), extra: 1 })).toContainEqual({
      path: "extra",
      problem: "حقلٌ زائدٌ لا في العقدِ",
    });
    const payloadExtra = clone(VALID_CREATED) as Record<string, unknown>;
    (payloadExtra.payload as Record<string, unknown>).surprise = true;
    expect(validateEnvelope(payloadExtra)).toContainEqual({
      path: "payload.surprise",
      problem: "حقلٌ زائدٌ لا في العقدِ",
    });
  });

  it("يرفضُ `event_type` لا يُطابِقُ نمطَ العقدِ", () => {
    const issues = validateEnvelope({ ...clone(VALID_CREATED), event_type: "CORE.Fulfillment" });
    expect(issues.some((issue) => issue.path === "event_type")).toBe(true);
  });

  it("يرفضُ `version` صفراً وكسريّاً — عددٌ صحيحٌ لا أقلَّ من واحدٍ", () => {
    expect(validateEnvelope({ ...clone(VALID_CREATED), version: 0 })).toContainEqual({
      path: "version",
      problem: "أصغرُ من 1",
    });
    expect(
      validateEnvelope({ ...clone(VALID_CREATED), version: 1.5 }).some((i) => i.path === "version"),
    ).toBe(true);
  });

  it("يرفضُ `producer` خارجَ الثلاثةِ", () => {
    const issues = validateEnvelope({ ...clone(VALID_CREATED), producer: "wasla-driver" });
    expect(issues.some((issue) => issue.path === "producer")).toBe(true);
  });

  it("يرفضُ وقتاً بلا منطقةٍ صريحةٍ وبلا ما تقبلُه `Date.parse` تسامحاً", () => {
    for (const bad of ["2026-09-11T10:00:00", "2026", "Sep 11 2026", "2026-09-11"]) {
      expect(
        validateEnvelope({ ...clone(VALID_CREATED), occurred_at: bad }).some(
          (issue) => issue.path === "occurred_at",
        ),
        bad,
      ).toBe(true);
    }
    for (const good of ["2026-09-11T10:00:00Z", "2026-09-11T10:00:00.123+03:00"]) {
      expect(validateEnvelope({ ...clone(VALID_CREATED), occurred_at: good }), good).toEqual([]);
    }
  });

  it("يرفضُ `correlation_id` فارغاً — الربطُ الفارغُ ربطٌ معدومٌ", () => {
    expect(validateEnvelope({ ...clone(VALID_CREATED), correlation_id: "" })).toContainEqual({
      path: "correlation_id",
      problem: "أقصرُ من 1",
    });
  });

  it("يرفضُ معرّفاً ليسَ uuid في المغلَّفِ والحمولةِ", () => {
    expect(validateEnvelope({ ...clone(VALID_CREATED), event_id: "not-a-uuid" })).toContainEqual({
      path: "event_id",
      problem: "ليسَ uuid",
    });
    const badPayload = clone(VALID_CREATED) as Record<string, unknown>;
    (badPayload.payload as Record<string, unknown>).fulfillment_id = "42";
    expect(validateEnvelope(badPayload)).toContainEqual({
      path: "payload.fulfillment_id",
      problem: "ليسَ uuid",
    });
  });

  it("يرفضُ نوعاً لا إعلانَ لحمولتِه ولا يُمرِّرُه بحمولةٍ غيرِ مدقَّقةٍ", () => {
    const unknownVersion = { ...clone(VALID_CREATED), version: 9 };
    expect(validateEnvelope(unknownVersion)).toContainEqual({
      path: "event_type",
      problem: "لا إعلانَ لحمولةِ core.fulfillment.created.v9",
    });
  });

  it("يجمعُ كلَّ العلَلِ لا أوّلَها — فمن يقرأُ السجلَّ يرى الخللَ كلَّه", () => {
    const broken = { event_id: "x", event_type: "bad", version: 0 };
    expect(validateEnvelope(broken).length).toBeGreaterThan(5);
  });

  it("`outcome` في `move.job.completed` محصورٌ في تمَّ/فشِلَ", () => {
    const spec = PAYLOAD_SPECS["move.job.completed.v1"];
    if (spec === undefined) throw new Error("إعلانٌ مفقودٌ");
    expect(
      validateObject(
        spec,
        {
          fulfillment_id: VALID_CREATED.event_id,
          job_id: "j",
          outcome: "cancelled",
          completed_at: "2026-09-11T10:00:00Z",
        },
        "",
      ).some((issue) => issue.path === "outcome"),
    ).toBe(true);
  });

  it("`settlement_state` اختياريٌّ في الإلغاءِ: يُقبَلُ غائباً ويُدقَّقُ حاضراً", () => {
    const spec = PAYLOAD_SPECS["core.fulfillment.cancelled.v1"];
    if (spec === undefined) throw new Error("إعلانٌ مفقودٌ");
    const base = {
      fulfillment_id: VALID_CREATED.event_id,
      order_reference: "order-1",
      reason: "rider_cancelled",
      cancelled_at: "2026-09-11T10:00:00Z",
    };
    expect(validateObject(spec, base, "")).toEqual([]);
    expect(validateObject(spec, { ...base, settlement_state: "held" }, "")).toEqual([]);
    expect(
      validateObject(spec, { ...base, settlement_state: "frozen" }, "").length,
    ).toBeGreaterThan(0);
  });
});

describe("حاجزُ التطابقِ — يُخفِقُ عندَ الانفراطِ", () => {
  it("يصمتُ عندَ التطابقِ الحقيقيِّ للمغلَّفِ", () => {
    expect(compareObject("envelope", ENVELOPE_SPEC, schema("envelope"))).toEqual([]);
  });

  it("يرصدُ حقلاً حُذِفَ من المخطَّطِ", () => {
    const mutated = clone(schema("envelope"));
    delete (mutated.properties as Record<string, unknown>).entity_id;
    expect(compareObject("envelope", ENVELOPE_SPEC, mutated).length).toBeGreaterThan(0);
  });

  it("يرصدُ مطلوباً زِيدَ في المخطَّطِ ولم يُعلَنْ عندَنا", () => {
    const mutated = clone(schema("core.fulfillment.created.v1"));
    (mutated.required as string[]).push("promised_at");
    const declared = PAYLOAD_SPECS["core.fulfillment.created.v1"];
    if (declared === undefined) throw new Error("إعلانٌ مفقودٌ");
    expect(
      compareObject("created", declared, mutated).some((b) => b.why.includes("promised_at")),
    ).toBe(true);
  });

  it("يرصدُ نوعاً تغيَّرَ، وقائمةَ قيمٍ توسَّعَت", () => {
    const typeChanged = clone(schema("envelope"));
    (
      (typeChanged.properties as Record<string, Record<string, unknown>>).version as Record<
        string,
        unknown
      >
    ).type = "string";
    expect(compareObject("envelope", ENVELOPE_SPEC, typeChanged).length).toBeGreaterThan(0);

    const enumWidened = clone(schema("envelope"));
    (
      (enumWidened.properties as Record<string, Record<string, unknown>>).producer as Record<
        string,
        unknown
      >
    ).enum = ["wasla-core", "wasla-move", "wasla-market", "wasla-ops"];
    expect(compareObject("envelope", ENVELOPE_SPEC, enumWidened).length).toBeGreaterThan(0);
  });

  it("يرصدُ مخطَّطاً فُتِحَ للحقلِ الزائدِ — فإعلانُنا يصيرُ أضيقَ من العقدِ", () => {
    const opened = clone(schema("envelope"));
    opened.additionalProperties = true;
    expect(
      compareObject("envelope", ENVELOPE_SPEC, opened).some((b) =>
        b.where.endsWith("additionalProperties"),
      ),
    ).toBe(true);
  });

  it("يرصدُ كلمةَ مخطَّطٍ لا يُنفِّذُها المُدقِّقُ ولا يُهمِلُها صامتاً", () => {
    const withMaxLength = clone(schema("envelope"));
    (
      (withMaxLength.properties as Record<string, Record<string, unknown>>).entity_type as Record<
        string,
        unknown
      >
    ).maxLength = 40;
    expect(
      compareObject("envelope", ENVELOPE_SPEC, withMaxLength).some((b) =>
        b.why.includes("maxLength"),
      ),
    ).toBe(true);
  });

  it("يصمتُ عندَ تطابقِ آلةِ الحالاتِ بالهجرتَينِ الحقيقيّتَينِ", () => {
    expect(compareStateMachine(W4, W5)).toEqual([]);
  });

  it("يرصدُ حالةً اختفَت من قيدِ الهجرةِ", () => {
    expect(compareStateMachine(W4.replaceAll("'cancelled'", "'void'"), W5).length).toBeGreaterThan(
      0,
    );
  });

  it("يرصدُ دالّةَ انتقالٍ اختفَت من الهجرةِ", () => {
    const renamed = W5.replaceAll("function accept_operational_job(", "function take_job(");
    expect(
      compareStateMachine(W4, renamed).some((b) => b.why.includes("accept_operational_job")),
    ).toBe(true);
  });

  it("يرصدُ صيغةَ مفتاحِ منعِ تكرارٍ بُدِّلَت في الهجرةِ", () => {
    const swapped = W5.replaceAll("'move.job.accepted:'", "'accepted:'");
    expect(compareStateMachine(W4, swapped).length).toBeGreaterThan(0);
  });
});
