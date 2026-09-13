/**
 * الغرض: قياسُ حاجزِ عقدِ مشاركةِ الرحلةِ — **حالةٌ سلبيّةٌ مبذورةٌ لكلِّ قاعدةٍ
 *   من الثمانِ** (`ح-7`: قاعدةٌ بلا حالةٍ سلبيّةٍ غيرُ مُنفَذةٍ).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-09`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * ولماذا تُقاسُ مدخلاتٌ مصنوعةٌ والمستودعُ معاً: المستودعُ اليومَ نظيفٌ، فلو
 * قِيسَ وحدَه لَنجحَ الاختبارُ ولو كانَ الحاجزُ لا يفحصُ شيئاً. **والحاجزُ الذي
 * لم يُرَ ساقطاً مرّةً لا يُعرَفُ أنّه يقفُ.**
 */

import { describe, expect, it } from "bun:test";
import { readRepository } from "../../scripts/check-ride-share-contract.ts";
import {
  disclosureTextProblems,
  identityLeakProblems,
  maxAgeParityProblems,
  type RideShareContractInput,
  rideShareContractProblems,
  shareAgeProblems,
  shareKeyParityProblems,
  shareRevokeProblems,
  singleJudgeProblems,
  tokenExposureProblems,
  usedShareKeys,
} from "../../scripts/lib/ride-share-contract.ts";

const SQL = `
insert into city_settings (key, value) values ('driver_position_max_age_seconds', '90'::jsonb);

create or replace function tracking_link_view(p_order_id uuid)
returns jsonb as $$
begin
  v_max_age := 90;
  return jsonb_build_object('position', jsonb_build_object('lat', 21.5, 'age_seconds', 4));
end;
$$ language plpgsql stable security invoker;

create or replace function rider_ride_share_state(p_telegram_id bigint, p_order_id uuid)
returns jsonb as $$
begin
  v_view := tracking_link_view(v_order.id);
end;
$$ language plpgsql stable security invoker;

create or replace function get_tracking_position(p_token text)
returns jsonb as $$
begin
  v_view := tracking_link_view(v_token.order_id);
end;
$$ language plpgsql stable security invoker;

revoke execute on function tracking_link_view(uuid) from public, anon, authenticated;
revoke execute on function rider_ride_share_state(bigint, uuid) from public, anon, authenticated;
revoke execute on function get_tracking_position(text) from public, anon, authenticated;
`;

const PUBLIC_SOURCE = `
const payload = { lat: position.lat, lng: position.lng, age_seconds: position.ageSeconds };
`;

const SURFACE = `
const line = { lat: preview.lat, lng: preview.lng, ageSeconds: preview.ageSeconds };
const a = t("rider.share.title");
`;

const ROUTE = `
  app.get("/v1/rides/:id/share", async (c) => {
    return c.json({ ok: true, links: s.links.map((link) => ({ id: link.id })) });
  });

  app.post("/v1/rides/:id/share", async (c) => {
    return c.json({ ok: true, url: outcome.link.url, token: outcome.link.token });
  });
`;

const DISCLOSURE = { shown: ["DRIVER_POSITION"], hidden: ["RIDER_PHONE"] } as const;

function dictionary(): Record<string, string> {
  return {
    "rider.share.title": "مشاركةُ الرحلةِ",
    "rider.share.disclosure.DRIVER_POSITION": "موقعُ السائقِ",
    "rider.share.disclosure.RIDER_PHONE": "رقمُ هاتفِكَ",
  };
}

function input(overrides: Partial<RideShareContractInput> = {}): RideShareContractInput {
  return {
    publicFiles: { "public-tracking.ts": PUBLIC_SOURCE },
    surface: { "RideShareCard.tsx": SURFACE },
    sql: SQL,
    route: ROUTE,
    domain: "export const SHARE_DISCLOSED = ['DRIVER_POSITION'];",
    maxAgeSeconds: 90,
    translations: { ar: dictionary(), en: dictionary(), ur: dictionary() },
    disclosure: { shown: [...DISCLOSURE.shown], hidden: [...DISCLOSURE.hidden] },
    ...overrides,
  };
}

describe("حاجزُ عقدِ المشاركةِ — الحالةُ الموجبةُ", () => {
  it("مدخلاتٌ سليمةٌ لا تُنتِجُ مشكلةً", () => {
    expect(rideShareContractProblems(input())).toEqual([]);
  });

  it("المستودعُ الحقيقيُّ نفسُه يمرُّ بالقواعدِ الثمانِ", () => {
    expect(rideShareContractProblems(readRepository())).toEqual([]);
  });
});

describe("القاعدة ١ — لا هويّةَ في الحمولةِ العامّةِ", () => {
  it("رقمُ هاتفٍ في المسارِ العامِّ يُسقِطُ الحاجزَ", () => {
    const problems = identityLeakProblems(
      input({ publicFiles: { "p.ts": "const p = { driver_phone: driver.phone };" } }),
    );
    expect(problems.some((text) => text.includes("driver_phone"))).toBe(true);
  });

  it("رقمُ اللوحةِ في الصفحةِ العامّةِ يُسقِطُ الحاجزَ", () => {
    const problems = identityLeakProblems(
      input({ publicFiles: { "page.ts": "html += plateNumber;" } }),
    );
    expect(problems.some((text) => text.includes("plateNumber"))).toBe(true);
  });

  it("معرّفُ الطلبِ في الحمولةِ العامّةِ يُسقِطُ الحاجزَ — رقمٌ يُخمَّنُ", () => {
    const problems = identityLeakProblems(
      input({ publicFiles: { "p.ts": "return c.json({ order_id: row.id });" } }),
    );
    expect(problems.some((text) => text.includes("order_id"))).toBe(true);
  });

  it("«name» وحدَها ليست حقلَ هويّةٍ فلا تُسقِطُ شيئاً", () => {
    const problems = identityLeakProblems(
      input({ publicFiles: { "p.ts": "const name = route.name;" } }),
    );
    expect(problems).toEqual([]);
  });
});

describe("القاعدة ٢ — لا موضعَ بلا عُمرِه", () => {
  it("قاعدةٌ تنشرُ إحداثيّةً بلا «age_seconds» تُسقِطُ الحاجزَ", () => {
    const problems = shareAgeProblems(
      input({ sql: "select jsonb_build_object('lat', 21.5, 'lng', 39.1);" }),
    );
    expect(problems.some((text) => text.includes("age_seconds"))).toBe(true);
  });

  it("حمولةٌ عامّةٌ فيها نقطةٌ بلا عُمرِها تُسقِطُ الحاجزَ", () => {
    const problems = shareAgeProblems(
      input({ publicFiles: { "p.ts": "const payload = { lat, lng };" } }),
    );
    expect(problems.some((text) => text.includes("بلا عُمرِها"))).toBe(true);
  });

  it("سطحٌ يرسمُ نقطةً بلا عُمرِها يُسقِطُ الحاجزَ", () => {
    const problems = shareAgeProblems(
      input({ surface: { "card.tsx": "const p = preview.lat.toFixed(5);" } }),
    );
    expect(problems.some((text) => text.includes("بلا عُمرِها"))).toBe(true);
  });
});

/**
 * ولمَ قاعدةٌ كاملةٌ لرقمٍ واحدٍ: **لأنَّ هذا الرقمَ هوَ العلّةُ الأصليّةُ**.
 * كانَ حدُّ الطزاجةِ عندَ المالكِ تسعينَ ثانيةً، ولم يكنْ لحاملِ الرابطِ حدٌّ
 * أصلاً — فكانَ الغريبُ يرى ما يُحجَبُ عن صاحبِ الرحلةِ. ورقمانِ يُكتَبانِ في
 * موضعَينِ يفترقانِ يوماً ولو بدآ متساويَينِ.
 */
describe("القاعدة ٣ — حدُّ العُمرِ حكمٌ واحدٌ", () => {
  it("بذرةٌ تخالفُ ثابتَ النطاقِ تُسقِطُ الحاجزَ", () => {
    const problems = maxAgeParityProblems(
      input({
        sql: SQL.replace(
          "'driver_position_max_age_seconds', '90'",
          "'driver_position_max_age_seconds', '300'",
        ),
      }),
    );
    expect(problems.some((text) => text.includes("تخالفُ ثابتَ النطاقِ"))).toBe(true);
  });

  it("احتياطٌ يخالفُ ثابتَ النطاقِ يُسقِطُ الحاجزَ", () => {
    const problems = maxAgeParityProblems(
      input({ sql: SQL.replace("v_max_age := 90;", "v_max_age := 600;") }),
    );
    expect(problems.some((text) => text.includes("احتياطُ الحدِّ"))).toBe(true);
  });

  it("هجرةٌ بلا بذرةٍ تُسقِطُ الحاجزَ — الإعدادُ غيرُ منشورٍ", () => {
    const problems = maxAgeParityProblems(input({ sql: "select 1; v_max_age := 90;" }));
    expect(problems.some((text) => text.includes("لا بذرةَ"))).toBe(true);
  });

  it("ثابتٌ غيرُ مقروءٍ يُسقِطُ الحاجزَ — لا حكمَ بلا مرجعٍ", () => {
    const problems = maxAgeParityProblems(input({ maxAgeSeconds: null }));
    expect(problems.some((text) => text.includes("لا حكمَ بلا مرجعٍ"))).toBe(true);
  });
});

describe("القاعدة ٤ — لا رمزَ في ردِّ قراءةٍ", () => {
  it("رمزٌ في ردِّ القراءةِ يُسقِطُ الحاجزَ", () => {
    const problems = tokenExposureProblems(
      input({
        route: `
  app.get("/v1/rides/:id/share", async (c) => {
    return c.json({ ok: true, token: link.token });
  });
`,
      }),
    );
    expect(problems.some((text) => text.includes("ينشرُ رمزاً"))).toBe(true);
  });

  it("الرمزُ في ردِّ الإصدارِ **لا** يُسقِطُ الحاجزَ — موضعُه الشرعيُّ", () => {
    expect(tokenExposureProblems(input())).toEqual([]);
  });

  it("مسارُ قراءةٍ غيرُ مقروءٍ يُسقِطُ الحاجزَ — لا يمرُّ بفراغٍ", () => {
    const problems = tokenExposureProblems(input({ route: "const app = 1;" }));
    expect(problems.some((text) => text.includes("لا يمرُّ بفراغٍ"))).toBe(true);
  });
});

describe("القاعدة ٥ — حَكَمٌ واحدٌ في القاعدةِ", () => {
  it("دالّةُ الغريبِ لا تُنادي الحَكَمَ تُسقِطُ الحاجزَ", () => {
    const problems = singleJudgeProblems(
      input({
        sql: SQL.replace("v_view := tracking_link_view(v_token.order_id);", "select 1;"),
      }),
    );
    expect(problems.some((text) => text.includes("get_tracking_position"))).toBe(true);
  });

  it("دالّةُ المالكِ لا تُنادي الحَكَمَ تُسقِطُ الحاجزَ", () => {
    const problems = singleJudgeProblems(
      input({ sql: SQL.replace("v_view := tracking_link_view(v_order.id);", "select 1;") }),
    );
    expect(problems.some((text) => text.includes("rider_ride_share_state"))).toBe(true);
  });

  it("غيابُ الحَكَمِ نفسِه يُسقِطُ الحاجزَ", () => {
    const problems = singleJudgeProblems(input({ sql: "select 1;" }));
    expect(problems.some((text) => text.includes("غيرُ مُنشَأٍ"))).toBe(true);
  });
});

describe("القاعدة ٦ — مفاتيحُ ثلاثةٌ متطابقةٌ", () => {
  it("مفتاحٌ ناقصٌ في لغةٍ يُسقِطُ الحاجزَ", () => {
    const lean = dictionary();
    delete lean["rider.share.title"];
    const problems = shareKeyParityProblems(
      input({ translations: { ar: dictionary(), en: lean, ur: dictionary() } }),
    );
    expect(problems.some((text) => text.includes("مفتاحٌ ناقصٌ"))).toBe(true);
  });

  it("مفتاحٌ يُنادى في السطحِ وليسَ في القاموسِ يُسقِطُ الحاجزَ", () => {
    const problems = shareKeyParityProblems(
      input({ surface: { "card.tsx": 'const a = t("rider.share.missingKey");' } }),
    );
    expect(problems.some((text) => text.includes("rider.share.missingKey"))).toBe(true);
  });

  it("قاموسٌ بلا مفتاحِ مشاركةٍ واحدٍ يُسقِطُ الحاجزَ — سطحٌ بلا نصٍّ", () => {
    const empty: Record<string, string> = { "rider.active.title": "رحلتُك" };
    const problems = shareKeyParityProblems(
      input({ translations: { ar: empty, en: empty, ur: empty } }),
    );
    expect(problems.some((text) => text.includes("سطحٌ بلا نصٍّ"))).toBe(true);
  });

  it("المفاتيحُ المُنادَاةُ تُستخرَجُ نصّاً حرفيّاً لا تُخمَّنُ", () => {
    const keys = usedShareKeys({
      "a.tsx": 't("rider.share.one"); t(`rider.share.two`); t("rider.active.three");',
    });
    expect([...keys]).toEqual(["rider.share.one"]);
  });
});

describe("القاعدة ٧ — كلُّ رمزِ إفصاحٍ له نصُّه", () => {
  it("رمزٌ جديدٌ بلا نصٍّ يُسقِطُ الحاجزَ — يُنشَرُ ولا يُقالُ لصاحبِه", () => {
    const problems = disclosureTextProblems(
      input({ disclosure: { shown: ["DRIVER_POSITION", "VEHICLE_COLOR"], hidden: [] } }),
    );
    expect(problems.some((text) => text.includes("VEHICLE_COLOR"))).toBe(true);
  });

  it("نصٌّ ناقصٌ في لغةٍ واحدةٍ يُسقِطُ الحاجزَ", () => {
    const lean = dictionary();
    delete lean["rider.share.disclosure.RIDER_PHONE"];
    const problems = disclosureTextProblems(
      input({ translations: { ar: dictionary(), en: lean, ur: dictionary() } }),
    );
    expect(problems.some((text) => text.includes("RIDER_PHONE"))).toBe(true);
  });

  it("قائمتانِ فارغتانِ تُسقِطانِ الحاجزَ — لا يمرُّ بفراغٍ", () => {
    const problems = disclosureTextProblems(input({ disclosure: { shown: [], hidden: [] } }));
    expect(problems.some((text) => text.includes("فارغتانِ"))).toBe(true);
  });
});

describe("القاعدة ٨ — لا دالّةَ بلا نزعِ تنفيذٍ", () => {
  it("دالّةٌ بلا نزعٍ تُسقِطُ الحاجزَ", () => {
    const problems = shareRevokeProblems(
      input({ sql: "create or replace function f_one(p uuid) returns jsonb as $$ $$;" }),
    );
    expect(problems.some((text) => text.includes("بلا نزعِ تنفيذٍ"))).toBe(true);
  });

  it("نزعٌ ناقصُ الأدوارِ يُسقِطُ الحاجزَ — «public» وحدَه لا يكفي", () => {
    const problems = shareRevokeProblems(
      input({
        sql:
          "create or replace function f_one(p uuid) returns jsonb as $$ $$;" +
          " revoke execute on function f_one(uuid) from public;",
      }),
    );
    expect(problems.some((text) => text.includes("anon"))).toBe(true);
    expect(problems.some((text) => text.includes("authenticated"))).toBe(true);
  });

  it("هجرةٌ بلا دالّةٍ واحدةٍ تُسقِطُ الحاجزَ", () => {
    const problems = shareRevokeProblems(input({ sql: "select 1;" }));
    expect(problems.some((text) => text.includes("قائمةٍ فارغةٍ"))).toBe(true);
  });
});
