/**
 * الغرض: قياسُ حاجزِ عقدِ الرحلةِ النشطةِ — **حالةٌ سلبيّةٌ مبذورةٌ لكلِّ قاعدةٍ
 *   من الخمسِ** (`ح-7`: قاعدةٌ بلا حالةٍ سلبيّةٍ غيرُ مُنفَذةٍ).
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
  keyParityProblems,
  moneyProblems,
  positionAgeProblems,
  unbuiltPathProblems,
  usedKeys,
} from "../../scripts/lib/active-ride-contract.ts";

const SQL = `
create or replace function active_ride_snapshot(p_telegram_id bigint, p_order_id uuid)
returns jsonb as $$
begin
  if v_order.assigned_driver_id is not null and v_order.status in ('matched','in_progress') then
    v_driver := jsonb_build_object('position', jsonb_build_object('age_seconds', 4));
  end if;
  return jsonb_build_object('driver', v_driver);
end;
$$ language plpgsql stable security invoker;
`;

const PORTS = `
export interface ActiveRideState {
  readonly driver: ActiveRideDriver | null;
}
`;

const CONTRACT = `
export type ActiveRideResponse = {
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

  it("المستودعُ الحقيقيُّ نفسُه يمرُّ بالقواعدِ الخمسِ", () => {
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
  it("زرُّ طوارئَ في السطحِ يُسقِطُ الحاجزَ", () => {
    const problems = unbuiltPathProblems(
      input({ surface: { "surface.tsx": 'const a = <button>{t("sos")}</button>;' } }),
    );
    expect(problems.some((text) => text.includes("لم يُبنَ"))).toBe(true);
  });

  it("مفتاحُ مشاركةٍ في قاموسٍ يُسقِطُ الحاجزَ", () => {
    const dirty = { ...dictionary(), "rider.active.share": "شارِك" };
    const problems = unbuiltPathProblems(
      input({ translations: { ar: dirty, en: dirty, ur: dirty } }),
    );
    expect(problems.some((text) => text.includes("مفتاحٌ لمسارٍ لم يُبنَ"))).toBe(true);
  });

  it("رابطُ هاتفٍ في السطحِ يُسقِطُ الحاجزَ", () => {
    const problems = unbuiltPathProblems(
      input({ surface: { "surface.tsx": 'const href = "tel:+966500000000";' } }),
    );
    expect(problems.some((text) => text.includes("tel:"))).toBe(true);
  });
});
