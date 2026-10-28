/**
 * الغرض: `LOAD-01` §5.8 (SINGLE_TRIP) — الالتقاطُ في رحلةٍ واحدةٍ: `request_id`
 *   يعودُ معَ الصفِّ منَ الدالّةِ فيسقطُ استعلامُ الارتباطِ الثاني. والغيابُ أو `0`
 *   = المسارُ الحاليّ (CUR) بنصِّه. والمفتاحُ الغائبُ منَ الاستجابةِ (دالّةٌ غيرَ
 *   مهاجرةٍ) يُتراجَعُ فيه إلى الاستعلامِ الثاني — الصحّةُ مقدَّمٌ على عددِ الرحلات.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import { notificationClaimSingleTripFromEnv } from "../../apps/workers/src/jobs/deliver-notifications.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { createNotificationOutboxPort } from "../../packages/infrastructure/notification/notification-outbox-adapters.ts";

const DID = "0b9e3c0e-6a43-4c55-9d52-3b0a8b7f2a11";
const RID = "req-0f1e2d3c4b5a69788796a5b4c3d2e1f0"; // يطابق CORRELATION_ID_SHAPE
const baseDelivery = {
  delivery_id: DID,
  kind: "rider_trip_notice",
  city_id: "c",
  claim_token: "t",
  attempts: 1,
  max_attempts: 3,
  batch_limit: 8,
  payload: {},
};

/** `sql` مزيّف: يسجّلُ نصَّ كلِّ استعلامٍ ويُرجعُ صفوفًا بحسبه. */
function fakeSql(opts: {
  delivery: typeof baseDelivery | null;
  requestId?: string | null | undefined;
  q2RequestId?: string | null;
}) {
  const texts: string[] = [];
  const fn = async (strings: TemplateStringsArray) => {
    const text = strings.join("$");
    texts.push(text);
    if (text.includes("claim_notification_delivery")) {
      const d = opts.delivery === null ? null : { ...opts.delivery };
      // مفتاحُ `request_id` حاضرٌ في الاستجابةِ فقط حينَ تُحاكي الدالّةُ المهاجرة
      // (قيمةً نصّيّةً أو null)؛ و`undefined` = الدالّةُ القديمةُ لا تُعيدُهُ أصلًا.
      const result =
        d === null || opts.requestId === undefined
          ? { ok: true, delivery: d }
          : { ok: true, delivery: { ...d, request_id: opts.requestId } };
      return [{ result }];
    }
    // استعلامُ الارتباطِ الثاني (CUR أو التراجعُ).
    return [{ request_id: opts.q2RequestId ?? null }];
  };
  return { sql: fn as unknown as Sql, texts };
}

describe("notificationClaimSingleTripFromEnv", () => {
  test("الغيابُ و`0` مطفأ؛ `1` مُشعِل؛ وما عداهما invalid", () => {
    expect(notificationClaimSingleTripFromEnv({})).toEqual({ enabled: false, invalid: false });
    expect(notificationClaimSingleTripFromEnv({ NOTIFICATION_CLAIM_SINGLE_TRIP: "" })).toEqual({
      enabled: false,
      invalid: false,
    });
    expect(notificationClaimSingleTripFromEnv({ NOTIFICATION_CLAIM_SINGLE_TRIP: "0" })).toEqual({
      enabled: false,
      invalid: false,
    });
    expect(notificationClaimSingleTripFromEnv({ NOTIFICATION_CLAIM_SINGLE_TRIP: "1" })).toEqual({
      enabled: true,
      invalid: false,
    });
    expect(notificationClaimSingleTripFromEnv({ NOTIFICATION_CLAIM_SINGLE_TRIP: "yes" })).toEqual({
      enabled: false,
      invalid: true,
    });
  });
});

describe("محوّلُ الصندوقِ مع SINGLE_TRIP", () => {
  test("مطفأ (CUR): استعلامانِ — الالتقاطُ ثمّ الارتباطُ؛ وrequestId كما في الاستعلامِ الثاني", async () => {
    const f = fakeSql({ delivery: baseDelivery, q2RequestId: RID });
    const r = await createNotificationOutboxPort(f.sql).claim();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(f.texts).toHaveLength(2);
    expect(f.texts[0]).toBe("select claim_notification_delivery() result");
    expect(f.texts[1]).toContain("select request_id from notification_outbox");
    expect(r.value.delivery?.requestId).toBe(RID);
  });

  test("مُشعَلٌ والمفتاحُ حاضرٌ: رحلةٌ واحدةٌ — لا استعلامِ ارتباطٍ؛ وrequestId منَ الصفِّ نفسِهِ", async () => {
    const f = fakeSql({ delivery: baseDelivery, requestId: RID });
    const r = await createNotificationOutboxPort(f.sql, { claimSingleTrip: true }).claim();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(f.texts).toHaveLength(1);
    expect(f.texts[0]).toBe("select claim_notification_delivery() result");
    expect(r.value.delivery?.requestId).toBe(RID);
    expect(r.value.delivery?.deliveryId).toBe(DID);
    expect(r.value.delivery?.claimToken).toBe("t");
    expect(r.value.delivery?.attempts).toBe(1);
    expect(r.value.delivery?.maxAttempts).toBe(3);
  });

  test("مُشعَلٌ وقيمةُ الصفِّ null: requestId=null برحلةٍ واحدةٍ (لا سياقَ لا سياقٌ مُلفَّقٌ)", async () => {
    const f = fakeSql({ delivery: baseDelivery, requestId: null });
    const r = await createNotificationOutboxPort(f.sql, { claimSingleTrip: true }).claim();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(f.texts).toHaveLength(1);
    expect(r.value.delivery?.requestId).toBeNull();
  });

  test("مُشعَلٌ ونصٌّ لا يطابقُ الصيغةَ: null لا مولَّدًا، برحلةٍ واحدةٍ", async () => {
    const f = fakeSql({ delivery: baseDelivery, requestId: "ليس معرّفًا" });
    const r = await createNotificationOutboxPort(f.sql, { claimSingleTrip: true }).claim();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(f.texts).toHaveLength(1);
    expect(r.value.delivery?.requestId).toBeNull();
  });

  test("مُشعَلٌ والمفتاحُ غائبٌ (دالّةٌ غيرَ مهاجرةٍ): تراجعٌ إلى الاستعلامِ الثاني — الصحّةُ قبلَ عددِ الرحلاتِ", async () => {
    const f = fakeSql({ delivery: baseDelivery, requestId: undefined, q2RequestId: RID });
    const r = await createNotificationOutboxPort(f.sql, { claimSingleTrip: true }).claim();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(f.texts).toHaveLength(2);
    expect(r.value.delivery?.requestId).toBe(RID);
  });

  test("مُشعَلٌ وبلا صفٍّ: استعلامٌ واحدٌ كما في CUR (لا ارتباطَ لما لا صفا له)", async () => {
    const f = fakeSql({ delivery: null, requestId: undefined });
    const r = await createNotificationOutboxPort(f.sql, { claimSingleTrip: true }).claim();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(f.texts).toHaveLength(1);
    expect(r.value.delivery).toBeNull();
    expect(r.value.backpressure).toBeNull();
  });
});
