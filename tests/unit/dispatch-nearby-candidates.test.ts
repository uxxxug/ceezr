/**
 * الغرض: تغطيةُ سطور تنفيذ `findNearbyAvailableForDispatch` في المحوّل — حسابُ
 * نصفِ القطرِ، وشرطُ عمرِ الموقعِ (فرعاه)، وترجمةُ الصفوفِ إلى مرشّحين — بلا
 * قاعدةٍ حقيقية. الاختبارُ التكاملّيّ على PostGIS يُثبِتُ صحةَ الاستعلامِ نفسِه؛
 * وهذا يُثبِتُ أنّ الترجمةَ والتفريعَ لا يكسرانِ شيئاً.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI (بوابةُ التغطية OPS-005)
 */
import { describe, expect, it } from "bun:test";
import type { NearbyCandidateQuery } from "../../packages/application/ports/index.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { createDriverCandidateRepository } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
import { isOk } from "../../packages/shared/result/index.ts";

interface Recorded {
  readonly text: string;
  readonly values: readonly unknown[];
  /** مسارُ الإرسالِ: قالبُ الوسومِ أم `unsafe` — الحارسُ يُلزمُ الثاني. */
  readonly via: "tagged" | "unsafe";
}

/** يُرجِعُ مصفوفةَ الصفوفِ مباشرةً — كما يفعلُ postgres.js في `sql<Row[]>` و`unsafe`. */
function fakeSqlReturning(rows: unknown[]): { sql: Sql; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const tagged = async (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
    calls.push({ text: strings.join("?"), values, via: "tagged" });
    return rows;
  };
  // الاستعلامُ في المحوّلِ يُرسَلُ عبرَ `sql.unsafe` بنصٍّ ثابتٍ ووسائطَ مُرقَّمةٍ —
  // فالبديلُ يسجّلُهُ بالبنيةِ نفسِها (راجعْ تعليقَ المحوّلِ: الخطةُ العامةُ للعبارةِ
  // المُسمّاةِ لا ترى قيمَ الوسائطِ فيُساوَقُ مسحُ الصندوقِ بدلَ فهرسِ المتاحينَ).
  (tagged as unknown as { unsafe: unknown }).unsafe = async (
    text: string,
    values: readonly unknown[],
  ) => {
    calls.push({ text, values, via: "unsafe" });
    return rows;
  };
  return { sql: tagged as unknown as Sql, calls };
}

const CITY = "city-jed" as CityId;
const DRIVER_ID = "11111111-1111-4111-8111-111111111111" as DriverId;

const PICKUP = { latitude: 21.5, longitude: 39.2 };

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    driver_id: DRIVER_ID,
    city_id: CITY,
    lat: 21.51,
    lng: 39.21,
    location_at_ms: "1757000000000",
    is_available: true,
    verification_status: "verified",
    is_blocked: false,
    preferred_lat: null,
    preferred_lng: null,
    rating_average: "4.5",
    rating_count: 10,
    services: ["taxi"],
    sub_plan: "standard",
    sub_status: "active",
    sub_trial_ends_at: null,
    sub_current_period_end: new Date("2026-12-31"),
    sub_cancel_at_period_end: false,
    ...overrides,
  };
}

function query(overrides: Partial<NearbyCandidateQuery> = {}): NearbyCandidateQuery {
  return {
    cityId: CITY,
    pickup: PICKUP,
    searchRadiusKm: 7,
    driverLocationMaxAgeSeconds: 0,
    limit: 50,
    now: new Date("2026-09-07T19:00:00Z"),
    ...overrides,
  };
}

async function run(
  rows: unknown[],
  q: NearbyCandidateQuery,
): Promise<{
  result: readonly unknown[];
  calls: Recorded[];
}> {
  const { sql, calls } = fakeSqlReturning(rows);
  const repo = createDriverCandidateRepository(sql);
  const outcome = await repo.findNearbyAvailableForDispatch(q);
  expect(isOk(outcome)).toBe(true);
  if (!isOk(outcome)) throw new Error("unexpected failure");
  return { result: outcome.value, calls };
}

describe("findNearbyAvailableForDispatch — الترجمة والتفريع على حدِّ المحوّل", () => {
  it("يُرجِعُ الصفوفَ مرشّحين كما وردوا، ويُمرِّرُ نصفَ القطرِ بالأمتار", async () => {
    const { result, calls } = await run(
      [row(), row({ driver_id: "22222222-2222-4222-8222-222222222222" })],
      query(),
    );

    expect(result).toHaveLength(2);
    const first = result[0] as { driverId: DriverId; location: unknown; isAvailable: boolean };
    expect(String(first.driverId)).toBe(DRIVER_ID);
    expect(first.location).toEqual({ latitude: 21.51, longitude: 39.21 });
    expect(first.isAvailable).toBe(true);
    // نصفُ القطرِ بالمتر لا بالكيلومتر: 7 كم ⇒ 7000 م. الشرطُ الفارغُ `sql```
    // يُسجّلُ نداءً منفصلاً قبلَ الاستعلامِ الرئيس، فنُفحِصُ عبرَ كلِّ النداءات.
    const allValues = calls.flatMap((c) => c.values);
    expect(allValues).toContain(7000);
    expect(allValues).toContain(50);
  });

  it("عمرُ الموقعِ صفرٌ ⇒ يُعطَّلُ شرطُ القِدَم (الفرعُ الفارغُ)", async () => {
    const { calls } = await run([row()], query({ searchRadiusKm: 10, limit: 25 }));
    // لا يُمرَّرُ maxAge إلى الاستعلام لأنّ الفرعَ الفارغَ هو المختار.
    expect(calls[0]?.text).not.toContain("last_location_at is not null");
  });

  it("عمرُ الموقعِ مُفعَّلٌ ⇒ يُضافُ شرطُ القِدَم بقيمتِه", async () => {
    const { calls } = await run(
      [row()],
      query({ searchRadiusKm: 10, limit: 25, driverLocationMaxAgeSeconds: 120 }),
    );
    expect(calls[0]?.text).toContain("last_location_at is not null");
    expect(calls[0]?.values).toContain(120);
  });

  it("الموقعُ معدومٌ ⇒ `location` و`locationAtMs` معدومانِ لا صفرٌ", async () => {
    const { result } = await run(
      [row({ lat: null, lng: null, location_at_ms: null })],
      query({ searchRadiusKm: 5, limit: 10 }),
    );
    const first = result[0] as { location: unknown; locationAtMs: unknown };
    expect(first.location).toBeNull();
    expect(first.locationAtMs).toBeNull();
  });

  it("الاشتراكُ معدومٌ ⇒ `subscription` معدومٌ", async () => {
    const { result } = await run(
      [row({ sub_status: null, sub_plan: null })],
      query({ searchRadiusKm: 5, limit: 10 }),
    );
    const first = result[0] as { subscription: unknown };
    expect(first.subscription).toBeNull();
  });

  it("الحارسُ: الاستعلامُ يُرسَلُ عبرَ unsafe لا قالبَ الوسومِ — وبترتيبِ وسائطَ صحيحٍ للفرعين", async () => {
    // قالبُ الوسومِ يُعِدُّ العبارةَ باسمٍ فتتحوّلُ خطّتُها بعدَ تنفيذاتٍ إلى العامةِ
    // التي لا ترى قيمَ الوسائطِ فيُساوَقُ مسحُ صندوقِ GiST (تدهورُ SOAK-02) — فالحارسُ
    // يُلزمُ المسارَ غيرَ المُعَدَّ (خطةٌ مخصَّصةٌ ترى الفهرسَ الجزئيَّ) وترتيبَ الوسائطِ.
    const plain = await run([row()], query());
    expect(plain.calls.map((call) => call.via)).toEqual(["unsafe"]);
    expect(plain.calls[0]?.values).toEqual([
      CITY,
      PICKUP.longitude,
      PICKUP.latitude,
      7000,
      PICKUP.longitude,
      PICKUP.latitude,
      50,
    ]);
    expect(plain.calls[0]?.text).toContain("order by d.last_location <->");
    expect(plain.calls[0]?.text).not.toContain("${");
    expect(plain.calls[0]?.text).toContain("a.is_available = true");

    const withAge = await run([row()], query({ driverLocationMaxAgeSeconds: 120 }));
    expect(withAge.calls.map((call) => call.via)).toEqual(["unsafe"]);
    expect(withAge.calls[0]?.values).toEqual([
      CITY,
      PICKUP.longitude,
      PICKUP.latitude,
      7000,
      new Date("2026-09-07T19:00:00Z"),
      120,
      PICKUP.longitude,
      PICKUP.latitude,
      50,
    ]);
    expect(withAge.calls[0]?.text).toContain(
      "(extract(epoch from ($5::timestamptz - d.last_location_at))) <= $6",
    );
  });
});
