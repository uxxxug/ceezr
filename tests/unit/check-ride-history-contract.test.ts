/**
 * الغرض: قياسُ حاجزِ عقدِ السجلِّ والتفاصيلِ — **حالةٌ سلبيّةٌ مبذورةٌ لكلِّ قاعدةٍ
 *   من الثمانِ** (`ح-7`: قاعدةٌ بلا حالةٍ سلبيّةٍ غيرُ مُنفَذةٍ).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-08`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci` وخطوةٌ مُسمَّاةٌ في CI.
 *
 * ولماذا تُقاسُ المدخلاتُ المصنوعةُ لا المستودعُ وحدَه: المستودعُ اليومَ **نظيفٌ**،
 * فلو قِيسَ وحدَه لَنجحَ الاختبارُ ولو كانَ الحاجزُ لا يفحصُ شيئاً. فالحالةُ
 * السلبيّةُ هيَ ما يُثبِتُ أنَّ القاعدةَ تعملُ، والحالةُ الموجبةُ تُقاسُ معَها.
 *
 * وما لا يفعلُه: لا يُثبِتُ أنَّ السجلَّ صادقٌ على قاعدةٍ حقيقيّةٍ — ذاكَ أثرٌ
 * يُقاسُ في `tests/integration/ride-history.test.ts` بمحرِّكٍ وساعتِه.
 */

import { describe, expect, it } from "bun:test";
import { readRepository } from "../../scripts/check-ride-history-contract.ts";
import {
  blankDeclaredAbsences,
  DECLARED_ABSENCE_KEYS,
  deviceClockProblems,
  functionRevokeProblems,
  keyParityProblems,
  mapAbsenceProblems,
  mentions,
  moneyProblems,
  offsetPagingProblems,
  type RideHistoryContractInput,
  rideHistoryContractProblems,
  SOS_ENTRY_SCREEN_FILES,
  sosEntryProblems,
  unbuiltPathProblems,
  unmeasuredNumberProblems,
  usedKeys,
} from "../../scripts/lib/ride-history-contract.ts";

const SQL = `
create or replace function rider_ride_history(p_telegram_id bigint, p_limit integer)
returns jsonb as $$ select '{}'::jsonb $$ language sql stable security invoker;

create or replace function public.rider_ride_detail(p_telegram_id bigint, p_order_id uuid)
returns jsonb as $$ select '{}'::jsonb $$ language sql stable security invoker;

revoke execute on function rider_ride_history(bigint, integer) from public, anon, authenticated;
revoke execute on function rider_ride_detail(bigint, uuid) from public, anon, authenticated;
`;

const SCREEN = `
const a = t("rider.history.title");
const b = t("rider.home.history.open");
const c = t("rider.history.detail.noMap");
const d = t("rider.history.detail.noSupport");
const rows = items.map((item) => item.orderId);
`;

function dictionary(): Record<string, string> {
  return {
    "rider.history.title": "سجلُّ الرحلاتِ",
    "rider.history.detail.noMap": "لا خريطةَ لمسارِ هذه الرحلةِ.",
    "rider.history.detail.noSupport": "فتحُ تذكرةِ دعمٍ غيرُ متاحٍ في هذا الإصدارِ.",
    "rider.home.history.open": "رحلاتي السابقةُ",
  };
}

function compliantSosScreens(): Record<string, string> {
  const entry =
    'import { SosEntry } from "../sos/SosEntry.tsx";\n{onOpenSos === undefined ? null : <SosEntry onOpen={onOpenSos} language={language} />}';
  const out: Record<string, string> = {};
  for (const path of SOS_ENTRY_SCREEN_FILES) out[path] = entry;
  return out;
}

function input(overrides: Partial<RideHistoryContractInput> = {}): RideHistoryContractInput {
  return {
    surface: { "surface.tsx": SCREEN, ...compliantSosScreens() },
    sql: SQL,
    translations: { ar: dictionary(), en: dictionary(), ur: dictionary() },
    ...overrides,
  };
}

function withScreen(extra: string): RideHistoryContractInput {
  return input({ surface: { "surface.tsx": `${SCREEN}\n${extra}` } });
}

describe("حاجزُ عقدِ السجلِّ والتفاصيلِ — الحالةُ الموجبةُ", () => {
  it("مدخلاتٌ سليمةٌ لا تُنتِجُ مشكلةً", () => {
    expect(rideHistoryContractProblems(input())).toEqual([]);
  });

  it("مدخلُ استغاثةٍ محذوفٌ يُسقِطُ الحاجزَ (`PD-020`)", () => {
    const problems = sosEntryProblems(input({ surface: { "surface.tsx": SCREEN } }));
    expect(problems).toHaveLength(2 * SOS_ENTRY_SCREEN_FILES.length);
  });

  it("المستودعُ الحقيقيُّ يمرُّ — وإلّا كانَ الحاجزُ يقيسُ خيالاً", () => {
    expect(rideHistoryContractProblems(readRepository())).toEqual([]);
  });

  it("`.map` على مصفوفةٍ ليسَت خريطةً — فلا يُسقِطُ البريءَ", () => {
    expect(mapAbsenceProblems(input())).toEqual([]);
  });
});

describe("القاعدة ١ — لا مالَ", () => {
  it("تسقطُ على شِفرةٍ تذكرُ أجرةً", () => {
    const problems = moneyProblems(withScreen(`const fare = order.fare;`));
    expect(problems.some((problem) => problem.includes("fare"))).toBe(true);
  });

  it("تسقطُ على نصٍّ يذكرُ إيصالاً", () => {
    const broken = { ...dictionary(), "rider.history.receipt": "إيصالُ الرحلةِ" };
    const problems = moneyProblems(input({ translations: { ar: broken, en: broken, ur: broken } }));
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe("القاعدة ٢ — لا خريطةَ موهومةً والغيابُ مُصرَّحٌ", () => {
  it("تسقطُ على مزوِّدِ خرائطَ في السطحِ", () => {
    const problems = mapAbsenceProblems(withScreen(`import mapbox from "mapbox-gl";`));
    expect(problems.some((problem) => problem.includes("mapbox"))).toBe(true);
  });

  it("تسقطُ حينَ يغيبُ نصُّ الغيابِ عن قاموسٍ", () => {
    const mute = { ...dictionary() };
    delete mute["rider.history.detail.noMap"];
    const problems = mapAbsenceProblems(
      input({ translations: { ar: dictionary(), en: mute, ur: dictionary() } }),
    );
    expect(problems.some((problem) => problem.startsWith("en:"))).toBe(true);
  });
});

describe("القاعدة ٣ — لا زرَّ لمسارٍ لم يُبنَ", () => {
  it("تسقطُ على زرِّ تذكرةِ دعمٍ", () => {
    const problems = unbuiltPathProblems(withScreen(`const onOpenSupportTicket = () => {};`));
    expect(problems.some((problem) => problem.includes("support"))).toBe(true);
  });

  it("تسقطُ حينَ يُسجَّلُ غيابٌ مُصرَّحٌ ولا يُناديهِ سطحٌ", () => {
    const problems = unbuiltPathProblems(input({ surface: { "surface.tsx": "const x = 1;" } }));
    expect(problems.some((problem) => problem.includes("لا يُناديهِ سطحٌ"))).toBe(true);
  });

  it("لا تسقطُ على مفتاحِ الغيابِ المُصرَّحِ نفسِه", () => {
    expect(unbuiltPathProblems(input())).toEqual([]);
  });
});

describe("القاعدة ٤ — لا رقمَ غيرَ مقيسٍ", () => {
  it("تسقطُ على مدّةِ رحلةٍ تُحسَبُ في السطحِ", () => {
    const problems = unmeasuredNumberProblems(
      withScreen(`const duration = completedAt - createdAt;`),
    );
    expect(problems.some((problem) => problem.includes("duration"))).toBe(true);
  });

  it("تسقطُ على مفتاحٍ يَعِدُ بمسافةٍ", () => {
    const broken = { ...dictionary(), "rider.history.distance": "{meters}" };
    const problems = unmeasuredNumberProblems(
      input({ translations: { ar: broken, en: broken, ur: broken } }),
    );
    expect(problems.some((problem) => problem.includes("distance"))).toBe(true);
  });
});

describe("القاعدة ٥ — لا ساعةَ جهازٍ", () => {
  it("تسقطُ على `toLocaleDateString`", () => {
    const problems = deviceClockProblems(withScreen(`const s = at.toLocaleDateString();`));
    expect(problems.some((problem) => problem.includes("toLocaleDateString"))).toBe(true);
  });

  it("تسقطُ على `resolvedOptions` — منطقةُ الجهازِ تُقرأُ ولا تُصرَّحُ", () => {
    const problems = deviceClockProblems(
      withScreen(`const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;`),
    );
    expect(problems.some((problem) => problem.includes("resolvedOptions"))).toBe(true);
  });
});

describe("القاعدة ٦ — ترقيمٌ بمفتاحٍ لا بإزاحةٍ", () => {
  it("تسقطُ على `offset` في الهجرةِ", () => {
    const problems = offsetPagingProblems(input({ sql: `${SQL}\nselect 1 offset 20;` }));
    expect(problems.some((problem) => problem.includes("offset"))).toBe(true);
  });

  it("تسقطُ على `offset` في السطحِ", () => {
    const problems = offsetPagingProblems(withScreen(`const offset = page * 20;`));
    expect(problems.some((problem) => problem.includes("surface.tsx"))).toBe(true);
  });
});

describe("القاعدة ٧ — مفاتيحُ ثلاثةٌ متطابقةٌ", () => {
  it("تسقطُ على مفتاحٍ ناقصٍ في لسانٍ", () => {
    const short = { ...dictionary() };
    delete short["rider.history.title"];
    const problems = keyParityProblems(
      input({ translations: { ar: dictionary(), en: short, ur: dictionary() } }),
    );
    expect(problems.some((problem) => problem.includes("rider.history.title"))).toBe(true);
  });

  it("تسقطُ على مفتاحٍ يُنادى ولا وجودَ له", () => {
    const problems = keyParityProblems(withScreen(`const z = t("rider.history.ghost");`));
    expect(problems.some((problem) => problem.includes("rider.history.ghost"))).toBe(true);
  });
});

describe("القاعدة ٨ — لا دالّةَ بلا نزعِ تنفيذٍ", () => {
  it("تسقطُ على دالّةٍ بلا نزعٍ", () => {
    const problems = functionRevokeProblems(
      input({ sql: SQL.replace(/revoke execute on function rider_ride_detail[^;]*;/, "") }),
    );
    expect(problems.some((problem) => problem.includes("rider_ride_detail"))).toBe(true);
  });

  it("تسقطُ على نزعٍ ناقصِ الأدوارِ", () => {
    const problems = functionRevokeProblems(
      input({ sql: SQL.replace("from public, anon, authenticated;", "from public;") }),
    );
    expect(problems.some((problem) => problem.includes("anon"))).toBe(true);
  });

  it("تسقطُ على هجرةٍ بلا دالّةٍ — لا تمرُّ بفراغٍ", () => {
    expect(functionRevokeProblems(input({ sql: "select 1;" })).length).toBeGreaterThan(0);
  });
});

describe("أدواتُ الحكمِ", () => {
  it("`mentions` تُطابِقُ الكلمةَ بحدودِها بعدَ فصلِ الحدودِ السنَّوريّةِ", () => {
    expect(mentions("onOpenSupportTicket", "support")).toBe(true);
    expect(mentions("supportive", "support")).toBe(false);
  });

  it("`blankDeclaredAbsences` تُفرِّغُ ولا تُقصِّرُ — فأرقامُ الأسطرِ تبقى صادقةً", () => {
    const text = `t("rider.history.detail.noMap")`;
    const blanked = blankDeclaredAbsences(text);
    expect(blanked.length).toBe(text.length);
    expect(blanked.includes("noMap")).toBe(false);
  });

  it("`usedKeys` تقرأُ البادئتَينِ معاً ولا تقرأُ سواهما", () => {
    const keys = usedKeys({ "s.tsx": SCREEN });
    expect(keys.has("rider.history.title")).toBe(true);
    expect(keys.has("rider.home.history.open")).toBe(true);
  });

  it("كلُّ غيابٍ مُصرَّحٍ له سببٌ ومالكٌ ورافعٌ — وإلّا صارَ السجلُّ بابَ إسكاتٍ", () => {
    expect(DECLARED_ABSENCE_KEYS.length).toBeGreaterThan(0);
    for (const absence of DECLARED_ABSENCE_KEYS) {
      expect(absence.reason.length).toBeGreaterThan(40);
      expect(absence.owner.length).toBeGreaterThan(0);
      expect(absence.liftedBy.length).toBeGreaterThan(0);
    }
  });
});
