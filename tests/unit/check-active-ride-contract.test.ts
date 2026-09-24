/**
 * الغرض: قياسُ حاجزِ عقدِ الرحلةِ النشطةِ — **حالةٌ سلبيّةٌ مبذورةٌ لكلِّ قاعدةٍ
 *   من الثمانِ** (`ح-7`: قاعدةٌ بلا حالةٍ سلبيّةٍ غيرُ مُنفَذةٍ). وكُنَّ ستّاً يومَ
 *   كُتِبَ هذا المِلفُّ، فزادَت `F2-09` سابعةً وزادَت `F2-10` ثامنةً.
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * ولماذا تُقاسُ المدخلاتُ المصنوعةُ لا المستودعُ وحدَه: المستودعُ اليومَ **نظيفٌ**،
 * فلو قِيسَ وحدَه لَنجحَ الاختبارُ ولو كانَ الحاجزُ لا يفحصُ شيئاً. فالحالةُ
 * السلبيّةُ هيَ ما يُثبِتُ أنَّ القاعدةَ تعملُ، والحالةُ الموجبةُ تُقاسُ معَها.
 */

import { describe, expect, it } from "bun:test";
import { readRepository } from "../../scripts/check-active-ride-contract.ts";
import {
  type ActiveRideContractInput,
  activeRideContractProblems,
  driverGateProblems,
  explicitPhaseProblems,
  functionRevokeProblems,
  keyParityProblems,
  moneyProblems,
  positionAgeProblems,
  sharePathProblems,
  sosPathProblems,
  unbuiltPathProblems,
  usedKeys,
} from "../../scripts/lib/active-ride-contract.ts";

const SQL = `
create or replace function active_ride_snapshot(p_telegram_id bigint, p_order_id uuid)
returns jsonb as $$
begin
  if v_order.assigned_driver_id is not null and v_order.status in ('matched','in_progress') then
    v_driver_name := nullif(split_part(coalesce(trim(v_full_name), ''), ' ', 1), '');
    select d.vehicle_type, d.plate_number, d.rating_average, d.rating_count
      into v_vehicle_type, v_plate_number, v_rating_average, v_rating_count;
    v_driver := jsonb_build_object(
      'first_name', v_driver_name,
      'vehicle_type', v_vehicle_type,
      'plate_number', v_plate_number,
      'rating_average', v_rating_average,
      'rating_count', v_rating_count,
      'position', jsonb_build_object('age_seconds', 4)
    );
  end if;
  return jsonb_build_object('driver', v_driver);
end;
$$ language plpgsql stable security invoker;
revoke execute on function active_ride_snapshot(bigint, uuid) from public, anon, authenticated;
`;

const PORTS = `
export interface ActiveRideDriver {
  readonly firstName: string | null;
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
}
export interface ActiveRideState {
  readonly driver: ActiveRideDriver | null;
}
`;

const CONTRACT = `
export type ApiActiveRideDriver = {
  readonly firstName: string | null;
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
};
export type ActiveRideResponse = {
  readonly phase: string;
  readonly driver: ApiActiveRideDriver | null;
  readonly lat: number;
  readonly ageSeconds: number;
};
`;

const SCREEN = `
const drawn = view.driver === null ? null : view.driver;
const a = <p className="ar__position-point" />;
const b = <p className="ar__position-age" />;
const c = t("rider.active.title");
const share = <RideShareCard orderId={orderId} />;
const rescue = <SosCard language={language} />;
`;

function dictionary(): Record<string, string> {
  return {
    "rider.active.title": "رحلتُك",
    "rider.active.position.point": "موقعُ السائقِ: {lat}, {lng}",
    "rider.active.position.ageSeconds": "قُرِئَ قبلَ {seconds} ثانيةً.",
    "rider.active.position.ageMinutes": "قُرِئَ قبلَ {minutes} دقيقةً.",
  };
}

function input(overrides: Partial<ActiveRideContractInput> = {}): ActiveRideContractInput {
  return {
    surface: { "surface.tsx": SCREEN },
    sql: SQL,
    ports: PORTS,
    contract: CONTRACT,
    screen: SCREEN,
    translations: { ar: dictionary(), en: dictionary(), ur: dictionary() },
    ...overrides,
  };
}

describe("حاجزُ عقدِ الرحلةِ النشطةِ — الحالةُ الموجبةُ", () => {
  it("مدخلاتٌ سليمةٌ لا تُنتِجُ مشكلةً", () => {
    expect(activeRideContractProblems(input())).toEqual([]);
  });

  it("المستودعُ الحقيقيُّ نفسُه يمرُّ بالقواعدِ الثمانِ", () => {
    expect(activeRideContractProblems(readRepository())).toEqual([]);
  });
});

describe("القاعدة ١ — لا مالَ", () => {
  it("كلمةُ سعرٍ في شِفرةِ السطحِ تُسقِطُ الحاجزَ", () => {
    const problems = moneyProblems(
      input({ surface: { "surface.tsx": 'const label = t("price");' } }),
    );
    expect(problems.some((text) => text.includes("مالاً"))).toBe(true);
  });

  it("كلمةُ أجرةٍ في نصٍّ عربيٍّ تُسقِطُ الحاجزَ", () => {
    const dirty = { ...dictionary(), "rider.active.note": "الأجرة تُدفَعُ نقداً" };
    const problems = moneyProblems(
      input({ translations: { ar: dirty, en: dictionary(), ur: dictionary() } }),
    );
    expect(problems.some((text) => text.includes("نصٌّ يذكرُ مالاً"))).toBe(true);
  });

  it("«shared» في مسارِ استيرادٍ لا تُقرأُ «share» ولا تُسقِطُ شيئاً", () => {
    const problems = unbuiltPathProblems(
      input({
        surface: { "surface.tsx": 'import { t } from "../../packages/shared/i18n/index.ts";' },
      }),
    );
    expect(problems).toEqual([]);
  });
});

describe("القاعدة ٢ — لا سائقَ بلا إسنادٍ", () => {
  it("لقطةٌ تبنيَ كتلةَ السائقِ بلا فحصِ الإسنادِ تُسقِطُ الحاجزَ", () => {
    const problems = driverGateProblems(
      input({ sql: "select jsonb_build_object('driver', v_driver);" }),
    );
    expect(problems.some((text) => text.includes("assigned_driver_id"))).toBe(true);
  });

  it("حقلُ سائقٍ غيرُ قابلٍ للعدمِ في المنفذِ يُسقِطُ الحاجزَ", () => {
    const problems = driverGateProblems(
      input({ ports: "export interface S { readonly driver: ActiveRideDriver; }" }),
    );
    expect(problems.some((text) => text.includes("غيرُ قابلٍ للعدمِ"))).toBe(true);
  });

  it("شاشةٌ ترسمُ السائقَ بلا فحصِ عدمِه تُسقِطُ الحاجزَ", () => {
    const problems = driverGateProblems(input({ screen: "const name = view.driver.firstName;" }));
    expect(problems.some((text) => text.includes("view.driver === null"))).toBe(true);
  });

  it("لقطةٌ بلا مفتاحِ vehicle_type تُسقِطُ الحاجزَ (F12-05)", () => {
    const problems = driverGateProblems(
      input({ sql: SQL.replace("'vehicle_type'", "/* removed */") }),
    );
    expect(problems.some((text) => text.includes("vehicle_type"))).toBe(true);
  });

  it("منفذٌ بلا firstName تُسقِطُ الحاجزَ (F12-05)", () => {
    const problems = driverGateProblems(input({ ports: PORTS.replace("firstName", "dummyName") }));
    expect(problems.some((text) => text.includes("firstName"))).toBe(true);
  });

  it("عقدٌ بلا plateNumber تُسقِطُ الحاجزَ (F12-05)", () => {
    const problems = driverGateProblems(
      input({ contract: CONTRACT.replace("plateNumber", "dummyPlate") }),
    );
    expect(problems.some((text) => text.includes("plateNumber"))).toBe(true);
  });

  it("حقولٌ في الإعلاناتِ لا في كائنِ السائقِ تُسقِطُ الحاجزَ (F12-05)", () => {
    // أزِلْ المفاتيحَ من كائنِ السائقِ معَ إبقاءِ الإعلاناتِ.
    const sqlNoJsonKeys = SQL.replace("'first_name'", "/* removed */")
      .replace("'vehicle_type'", "/* removed */")
      .replace("'plate_number'", "/* removed */")
      .replace("'rating_average'", "/* removed */")
      .replace("'rating_count'", "/* removed */");
    const problems = driverGateProblems(input({ sql: sqlNoJsonKeys }));
    expect(problems.some((text) => text.includes("vehicle_type"))).toBe(true);
  });
});

describe("القاعدة ٣ — لا موضعَ بلا عُمرِه", () => {
  it("لقطةٌ تنشرُ موضعاً بلا عُمرٍ تُسقِطُ الحاجزَ", () => {
    const problems = positionAgeProblems(
      input({ sql: "select jsonb_build_object('position', jsonb_build_object('lat', 21.5));" }),
    );
    expect(problems.some((text) => text.includes("age_seconds"))).toBe(true);
  });

  it("عقدٌ ينشرُ إحداثيّةً بلا «ageSeconds» يُسقِطُ الحاجزَ", () => {
    const problems = positionAgeProblems(
      input({ contract: "export type R = { readonly lat: number; readonly lng: number };" }),
    );
    expect(problems.some((text) => text.includes("ageSeconds"))).toBe(true);
  });

  it("شاشةٌ ترسمُ نقطةً بلا سطرِ عُمرِها تُسقِطُ الحاجزَ", () => {
    const problems = positionAgeProblems(
      input({ screen: 'const a = <p className="ar__position-point" />;' }),
    );
    expect(problems.some((text) => text.includes("بلا سطرِ عُمرِها"))).toBe(true);
  });

  it("قاموسٌ فيه نصُّ النقطةِ بلا نصِّ عُمرِها يُسقِطُ الحاجزَ", () => {
    const lean = { "rider.active.position.point": "موقعٌ" };
    const problems = positionAgeProblems(input({ translations: { ar: lean, en: lean, ur: lean } }));
    expect(problems.some((text) => text.includes("عُمرِها غائبٌ"))).toBe(true);
  });
});

describe("القاعدة ٤ — مفاتيحُ ثلاثةٌ متطابقةٌ", () => {
  it("مفتاحٌ ناقصٌ في لغةٍ يُسقِطُ الحاجزَ", () => {
    const lean = dictionary();
    delete lean["rider.active.title"];
    const problems = keyParityProblems(
      input({ translations: { ar: dictionary(), en: lean, ur: dictionary() } }),
    );
    expect(problems.some((text) => text.includes("مفتاحٌ ناقصٌ"))).toBe(true);
  });

  it("مفتاحٌ يُنادى في السطحِ وليسَ في القاموسِ يُسقِطُ الحاجزَ", () => {
    const problems = keyParityProblems(
      input({ surface: { "surface.tsx": 'const a = t("rider.active.missingKey");' } }),
    );
    expect(problems.some((text) => text.includes("rider.active.missingKey"))).toBe(true);
  });

  it("المفاتيحُ المُنادَاةُ تُستخرَجُ نصّاً حرفيّاً لا تُخمَّنُ", () => {
    const keys = usedKeys({
      "a.tsx": 't("rider.active.one"); t(`rider.active.two`); t("rider.other");',
    });
    expect([...keys]).toEqual(["rider.active.one"]);
  });
});

describe("القاعدة ٥ — لا زرَّ لمسارٍ لم يُبنَ", () => {
  /**
   * `F2-10` (2026-09-14): هذه الحالةُ **انقلبَ حكمُها ولم تُحذَفْ** (`ح-2`).
   * كانَت تُسقِطُ الحاجزَ لأنَّ مسارَ الاستغاثةِ لم يُبنَ؛ وقد بُنِيَ اليومَ
   * كاملاً — دالّتانِ في القاعدةِ ومنفذٌ ومساران وبطاقةٌ — فذكرُ «sos» في سطحٍ
   * لم يبقَ زرّاً كاذباً. **والحراسةُ لم تسقطْ بل انتقلَت**: القاعدةُ ٨ أدناه
   * تطلبُ البطاقةَ مُركَّبةً فعلاً، ومفاتيحُ `rider.active.` ما زالت ممنوعةً من
   * لفظِ الاستغاثةِ (الحالةُ التاليةُ) — فلا مَوضِعَ خلا من حاجزٍ.
   */
  it("ذكرُ الاستغاثةِ في سطحٍ لم يبقَ زرّاً كاذباً — المسارُ بُنِيَ (`F2-10`)", () => {
    const problems = unbuiltPathProblems(
      input({ surface: { "surface.tsx": 'const a = <button>{t("rider.sos.arm")}</button>;' } }),
    );
    expect(problems).toEqual([]);
  });

  it("مفتاحُ استغاثةٍ في نطاقِ اللقطةِ يُسقِطُ الحاجزَ — موضعُه «rider.sos.»", () => {
    const dirty = { ...dictionary(), "rider.active.sos": "نجدة" };
    const problems = unbuiltPathProblems(
      input({ translations: { ar: dirty, en: dirty, ur: dirty } }),
    );
    expect(problems.some((text) => text.includes("موضعُه «rider.sos.»"))).toBe(true);
  });

  it("زرُّ اتّصالٍ بالسائقِ ما زالَ زرّاً كاذباً — لا مزوِّدَ مكالماتٍ", () => {
    const problems = unbuiltPathProblems(
      input({ surface: { "surface.tsx": "const a = <button onClick={callDriver} />;" } }),
    );
    expect(problems.some((text) => text.includes("لم يُبنَ"))).toBe(true);
  });

  /**
   * `F2-09` (2026-09-14): هذه الحالةُ **ما زالت تُسقِطُ الحاجزَ**، وتغيَّرَ حكمُها
   * لا نتيجتُها: مسارُ المشاركةِ بُنِيَ، فلم يعدْ مفتاحُه «مساراً لم يُبنَ» بل
   * **مفتاحاً في غيرِ نطاقِه** (موضعُه `rider.share.`). والتأكيدُ صارَ على
   * السقوطِ نفسِه ثمَّ على الحكمِ الجديدِ — ولم تُحذَفْ حالةٌ ولم يُخفَّفْ فحصٌ.
   */
  it("مفتاحُ مشاركةٍ في نطاقِ اللقطةِ يُسقِطُ الحاجزَ", () => {
    const dirty = { ...dictionary(), "rider.active.share": "شارِك" };
    const problems = unbuiltPathProblems(
      input({ translations: { ar: dirty, en: dirty, ur: dirty } }),
    );
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((text) => text.includes("موضعُه «rider.share.»"))).toBe(true);
  });

  it("رابطُ هاتفٍ في السطحِ يُسقِطُ الحاجزَ", () => {
    const problems = unbuiltPathProblems(
      input({ surface: { "surface.tsx": 'const href = "tel:+966500000000";' } }),
    );
    expect(problems.some((text) => text.includes("tel:"))).toBe(true);
  });
});

/**
 * ولمَ زُرِعَت هذه الحالاتُ **بعدَ** أوّلِ حكمِ CI لا قبلَه: لأنَّ الدفعةَ
 * الأولى مرَّت بخمسِ قواعدَ محلّيّاً ثمَّ **أسقطَها CI** في اختبارِ سطحِ
 * الصلاحيّاتِ — كانَ `active_ride_snapshot` منفَّذاً من `public` لأنَّ المنحَ
 * ضمنيٌّ ولا حاجزَ ساكنٌ يقرؤه. فالقاعدةُ السادسةُ **أثرُ إخفاقٍ حقيقيٍّ
 * موثَّقٍ**، وهذه حالاتُها السلبيّةُ كي لا تكونَ نصّاً بلا إنفاذٍ (`ح-7`).
 */
describe("القاعدة ٦ — لا دالّةَ بلا نزعِ تنفيذٍ", () => {
  it("هجرةٌ تُنشئُ دالّةً ولا تنزعُ تنفيذَها تُسقِطُ الحاجزَ", () => {
    const problems = functionRevokeProblems(
      input({ sql: "create function active_ride_snapshot(p_id bigint) returns jsonb as $$ $$;" }),
    );
    expect(problems.some((text) => text.includes("ولا تنزعُ تنفيذَها"))).toBe(true);
  });

  it("نزعٌ ناقصُ الأدوارِ يُسقِطُ الحاجزَ — «public» وحدَه لا يكفي", () => {
    const problems = functionRevokeProblems(
      input({
        sql:
          "create function active_ride_snapshot(p_id bigint) returns jsonb as $$ $$;" +
          " revoke execute on function active_ride_snapshot(bigint) from public;",
      }),
    );
    expect(problems.some((text) => text.includes("anon"))).toBe(true);
    expect(problems.some((text) => text.includes("authenticated"))).toBe(true);
  });

  it("نزعٌ لدالّةٍ أخرى لا يُعَدُّ نزعاً لهذه", () => {
    const problems = functionRevokeProblems(
      input({
        sql:
          "create function active_ride_snapshot(p_id bigint) returns jsonb as $$ $$;" +
          " revoke execute on function other_function(bigint) from public, anon, authenticated;",
      }),
    );
    expect(problems.some((text) => text.includes("ولا تنزعُ تنفيذَها"))).toBe(true);
  });

  it("هجرةٌ بلا دالّةٍ واحدةٍ تُسقِطُ الحاجزَ — لا تمرُّ بقائمةٍ فارغةٍ", () => {
    const problems = functionRevokeProblems(input({ sql: "select 1;" }));
    expect(problems.some((text) => text.includes("قائمةٍ فارغةٍ"))).toBe(true);
  });

  it("دالّتانِ في هجرةٍ واحدةٍ: نزعُ واحدةٍ لا يُبرِّئُ الأخرى", () => {
    const problems = functionRevokeProblems(
      input({
        sql:
          "create function a_fn(p_id bigint) returns jsonb as $$ $$;" +
          " create function b_fn(p_id bigint) returns jsonb as $$ $$;" +
          " revoke execute on function a_fn(bigint) from public, anon, authenticated;",
      }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("b_fn");
  });
});

/**
 * ## إضافةُ البند `F2-09` (2026-09-14)
 *
 * القاعدةُ ٧ **عكسُ** الخامسةِ: تلكَ تمنعُ باباً لمسارٍ لا يعملُ، وهذه تمنعُ
 * مساراً يعملُ بلا بابٍ. وزُرِعَت لها حالاتُها السلبيّةُ ههنا (`ح-7`)، ولم
 * يُمَسَّ سطرٌ ممّا فوقَ (`ح-1` و`ح-2`) سوى **زيادةِ** تركيبِ البطاقةِ إلى
 * مُدخَلِ الشاشةِ المصنوعِ — فالمُدخَلُ السليمُ يجبُ أن يبقى سليماً بعدَ زيادةِ
 * قاعدةٍ، وإلّا كانَت الحالةُ الموجبةُ كاذبةً.
 */
describe("القاعدة ٧ — المسارُ المبنيُّ يُركَّبُ فعلاً (`F2-09`)", () => {
  it("شاشةٌ بلا بطاقةِ مشاركةٍ تُسقِطُ الحاجزَ", () => {
    const problems = sharePathProblems(input({ screen: "const a = 1;" }));
    expect(problems.some((text) => text.includes("RideShareCard"))).toBe(true);
  });

  it("بطاقةٌ مُركَّبةٌ بلا «orderId» تُسقِطُ الحاجزَ — بطاقةٌ بلا رحلةٍ", () => {
    const problems = sharePathProblems(input({ screen: "const a = <RideShareCard />;" }));
    expect(problems.some((text) => text.includes("orderId"))).toBe(true);
  });

  it("ذكرُ الاسمِ في تعليقٍ لا يكفي — التركيبُ وسمٌ لا كلمةٌ", () => {
    const problems = sharePathProblems(
      input({ screen: "const note = 'RideShareCard سيُركَّبُ لاحقاً';" }),
    );
    expect(problems.some((text) => text.includes("غيرُ مُركَّبةٍ"))).toBe(true);
  });

  it("الشاشةُ المصنوعةُ السليمةُ تمرُّ", () => {
    expect(sharePathProblems(input())).toEqual([]);
  });
});

/**
 * ولمَ قاعدةٌ ثامنةٌ تُشبِهُ السابعةَ: لأنَّ المقيسَ غيرُ المقيسِ. السابعةُ
 * تحرسُ بطاقةَ مشاركةٍ، وهذه تحرسُ بطاقةَ استغاثةٍ — والثانيةُ **تُخلِفُ
 * صامتةً**: مشاركةٌ لا تظهرُ يشكو منها صاحبُها في دقيقةٍ، واستغاثةٌ لا تظهرُ
 * لا يشكو منها أحدٌ لأنَّ مَن احتاجَها لا يفتحُ تذكرةً. ولو جُمِعَتا في قاعدةٍ
 * واحدةٍ لَسقطَتا معاً برسالةٍ واحدةٍ تُرسِلُ مُصلِحَها إلى المِلفِّ الخطأِ.
 */
describe("القاعدة ٨ — بطاقةُ الاستغاثةِ تُركَّبُ فعلاً (`F2-10`)", () => {
  it("شاشةٌ بلا بطاقةِ استغاثةٍ تُسقِطُ الحاجزَ", () => {
    const problems = sosPathProblems(input({ screen: "const a = 1;" }));
    expect(problems.some((text) => text.includes("SosCard"))).toBe(true);
  });

  it("ذكرُ الاسمِ في نصٍّ لا يكفي — التركيبُ وسمٌ لا كلمةٌ", () => {
    const problems = sosPathProblems(input({ screen: "const note = 'SosCard سيُركَّبُ لاحقاً';" }));
    expect(problems.some((text) => text.includes("غيرُ مُركَّبةٍ"))).toBe(true);
  });

  /**
   * وبخلافِ القاعدةِ ٧ **لا يُطلَبُ «orderId»**: الطلبُ يُحَلُّ في القاعدةِ تحتَ
   * القفلِ (`ADR 0077`)، وسطحُ الاستغاثةِ يبقى مفتوحاً دقائقَ بعدَ انتهاءِ
   * الرحلةِ فلا رحلةَ «جاريةً» تُمرَّرُ إليه أصلاً. وهذه الحالةُ تُثبِتُ أنَّ
   * الغيابَ مقصودٌ لا مَسهوٌّ عنه.
   */
  it("بطاقةٌ بلا «orderId» تمرُّ — الطلبُ يُحَلُّ في القاعدةِ لا في الشاشةِ", () => {
    const problems = sosPathProblems(
      input({ screen: "const a = <RideShareCard orderId={orderId} />; const b = <SosCard />;" }),
    );
    expect(problems).toEqual([]);
  });

  it("الشاشةُ المصنوعةُ السليمةُ تمرُّ", () => {
    expect(sosPathProblems(input())).toEqual([]);
  });
});

/**
 * القاعدة ٩ (`F2-06` الخطوة الثانية) — الحالةُ الصريحةُ في العقدِ لا في الواجهةِ.
 *
 * الطورُ `driver_arrived` صارَ حالةَ عقدٍ من الدرجةِ الأولى. فالواجهةُ تقرأُ
 * `phase` من الخادمِ ولا تُعيدُ اشتقاقَهُ. وكلُّ اشتقاقٍ في الواجهةِ مصدرُ
 * حقيقةٍ ثانٍ يفترقُ عن الأوّلِ يوماً.
 */
describe("القاعدة ٩ — الحالةُ الصريحةُ في العقدِ لا في الواجهةِ (`F2-06` الخطوة الثانية)", () => {
  it("واجهةٌ تشتقُّ الطورَ من «arrivedAt» تُسقِطُ الحاجزَ", () => {
    const problems = explicitPhaseProblems(
      input({ surface: { "view.ts": "if (view.arrivedAt !== null) return 'arrived';" } }),
    );
    expect(problems.some((text) => text.includes("arrivedAt"))).toBe(true);
  });

  it("واجهةٌ تشتقُّ الطورَ من «arrivedAtMs» تُسقِطُ الحاجزَ", () => {
    const problems = explicitPhaseProblems(
      input({ surface: { "view.ts": "const arrived = view.arrivedAtMs !== null;" } }),
    );
    expect(problems.some((text) => text.includes("arrivedAtMs"))).toBe(true);
  });

  it("واجهةٌ تشتقُّ الطورَ من «status» و«matched» تُسقِطُ الحاجزَ", () => {
    const problems = explicitPhaseProblems(
      input({ surface: { "view.ts": "if (view.status === 'matched' && driver) ...;" } }),
    );
    expect(problems.some((text) => text.includes("status"))).toBe(true);
  });

  it("عقدٌ بلا «phase» يُسقِطُ الحاجزَ — الواجهةُ لا تملكُ ما تقرأُهُ", () => {
    const problems = explicitPhaseProblems(
      input({ contract: "export type X = { readonly driver: null; };" }),
    );
    expect(problems.some((text) => text.includes("phase"))).toBe(true);
  });

  it("واجهةٌ تقرأُ «phase» الصريحَ تمرُّ", () => {
    const problems = explicitPhaseProblems(
      input({ surface: { "view.ts": "if (view.phase === 'driver_arrived') return 'arrived';" } }),
    );
    expect(problems).toEqual([]);
  });
});
