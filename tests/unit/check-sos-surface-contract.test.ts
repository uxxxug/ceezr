/**
 * الغرض: قياسُ حاجزِ عقدِ سطحِ الاستغاثةِ — **حالةٌ سلبيّةٌ مبذورةٌ لكلِّ قاعدةٍ
 *   من الستِّ** (`ح-7`: قاعدةٌ بلا حالةٍ سلبيّةٍ غيرُ مُنفَذةٍ).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-10`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 *
 * ولماذا تُقاسُ مدخلاتٌ مصنوعةٌ والمستودعُ معاً: المستودعُ اليومَ نظيفٌ، فلو
 * قِيسَ وحدَه لَنجحَ الاختبارُ ولو كانَ الحاجزُ لا يفحصُ شيئاً. **والحاجزُ الذي
 * لم يُرَ ساقطاً مرّةً لا يُعرَفُ أنّه يقفُ.**
 */

import { describe, expect, it } from "bun:test";
import { readRepository } from "../../scripts/check-sos-surface-contract.ts";
import {
  API_FILE,
  callPromiseProblems,
  deviceClockProblems,
  disclosureTextProblems,
  functionRevokeProblems,
  mandatoryDisclosureProblems,
  orderIdInPathProblems,
  type SosSurfaceContractInput,
  sosSurfaceContractProblems,
  VIEW_FILE,
} from "../../scripts/lib/sos-surface-contract.ts";

const SQL = `
create or replace function sos_post_ride_window(p_city_id uuid)
returns jsonb as $$ select jsonb_build_object('minutes', 30); $$ language sql stable;

create or replace function sos_surface_state(p_telegram_id bigint, p_role text)
returns jsonb as $$
begin
  v_disclosure := jsonb_build_array('SOS_SHARES_ROLE', 'SOS_NO_PHONE_CALL');
end;
$$ language plpgsql stable security definer;

revoke execute on function sos_post_ride_window(uuid) from public, anon, authenticated;
revoke execute on function sos_surface_state(bigint, text) from public, anon, authenticated;
`;

const CARD = `
const visible = isSosCardVisible(state);
return <button onClick={() => setArmed(true)}>{t("rider.sos.arm")}</button>;
`;

const VIEW = `
export function incidentAgeText(seconds: number): string { return String(seconds); }
`;

const API = `
export async function triggerSos(): Promise<SosTriggerResponse> {
  return apiFetch<SosTriggerResponse>("/v1/safety/sos", { method: "POST" });
}
`;

const CONTRACT = `export interface SosSurfaceResponse { readonly ok: boolean; }`;

const ROUTE = `
  app.get("/v1/safety/sos", async (c) => c.json({ ok: true }));
  app.post("/v1/safety/sos", async (c) => c.json({ ok: true }));
`;

const CODES = ["SOS_SHARES_ROLE", "SOS_NO_PHONE_CALL"] as const;

function dictionary(): Record<string, string> {
  return {
    "rider.sos.title": "الاستغاثةُ",
    "rider.sos.arm": "طلبُ نجدةٍ",
    "rider.sos.disclosure.SOS_SHARES_ROLE": "يُرسَلُ دورُكَ في الرحلةِ",
    "rider.sos.disclosure.SOS_NO_PHONE_CALL": "لا تُجري هذه الضغطةُ مكالمةً",
  };
}

function input(overrides: Partial<SosSurfaceContractInput> = {}): SosSurfaceContractInput {
  return {
    surface: {
      "apps/miniapp/src/surfaces/rider/sos/SosCard.tsx": CARD,
      [VIEW_FILE]: VIEW,
      [API_FILE]: API,
      "apps/miniapp/src/surfaces/rider/sos/sos-contract.ts": CONTRACT,
    },
    sql: SQL,
    route: ROUTE,
    translations: { ar: dictionary(), en: dictionary(), ur: dictionary() },
    disclosureCodes: [...CODES],
    ...overrides,
  };
}

describe("حاجزُ سطحِ الاستغاثةِ — الحالةُ الموجبةُ", () => {
  it("مدخلاتٌ سليمةٌ لا تُنتِجُ مشكلةً", () => {
    expect(sosSurfaceContractProblems(input())).toEqual([]);
  });

  it("المستودعُ الحقيقيُّ نفسُه يمرُّ بالقواعدِ الستِّ", () => {
    expect(sosSurfaceContractProblems(readRepository())).toEqual([]);
  });
});

/**
 * ولمَ قاعدةٌ كاملةٌ لوعدِ الاتّصالِ: لأنَّ `SR-06` يطلبُ **اتّصالاً** معَ
 * الطوارئِ، والاتّصالُ لم يُبنَ ولا مزوِّدَ له. فبناءُ الاستغاثةِ لا يُطلِقُ زرَّ
 * اتّصالٍ معه — بل يجعلُ منعَه أوجبَ: مَن رأى بطاقةَ استغاثةٍ تعملُ صدَّقَ أنَّ
 * زرَّ الاتّصالِ يعملُ مثلَها فانتظرَ مكالمةً لا تأتي.
 */
describe("القاعدة ١ — لا وعدَ اتّصالٍ", () => {
  it("رابطُ هاتفٍ في البطاقةِ يُسقِطُ الحاجزَ", () => {
    const problems = callPromiseProblems(
      input({ surface: { ...input().surface, "c.tsx": '<a href="tel:911">نجدة</a>' } }),
    );
    expect(problems.some((text) => text.includes("tel:"))).toBe(true);
  });

  it("واتساب في مسارِ السلامةِ يُسقِطُ الحاجزَ", () => {
    const problems = callPromiseProblems(input({ route: 'const url = "https://wa.me/966";' }));
    expect(problems.some((text) => text.includes("wa.me"))).toBe(true);
  });

  it("نصٌّ يَعِدُ بمكالمةٍ عبرَ واتساب يُسقِطُ الحاجزَ", () => {
    const broken = { ...dictionary(), "rider.sos.arm": "سنراسلُكَ على whatsapp" };
    const problems = callPromiseProblems(
      input({ translations: { ar: broken, en: dictionary(), ur: dictionary() } }),
    );
    expect(problems.some((text) => text.includes("ar:rider.sos.arm"))).toBe(true);
  });

  it("نصٌّ يُرشِدُ إلى الطوارئِ العامّةِ لا يُسقِطُ شيئاً — إرشادٌ لا وعدٌ", () => {
    const advice = { ...dictionary(), "rider.sos.arm": "اتّصلْ بالطوارئِ العامّةِ إن كنتَ في خطرٍ" };
    const problems = callPromiseProblems(
      input({ translations: { ar: advice, en: dictionary(), ur: dictionary() } }),
    );
    expect(problems).toEqual([]);
  });
});

describe("القاعدة ٢ — لا رمزَ إفصاحٍ بلا نصٍّ", () => {
  it("رمزٌ منشورٌ بلا مفتاحٍ في العربيّةِ يُسقِطُ الحاجزَ", () => {
    const problems = disclosureTextProblems(
      input({ disclosureCodes: [...CODES, "SOS_NOTIFIES_CITY_TEAM"] }),
    );
    expect(problems.some((text) => text.includes("SOS_NOTIFIES_CITY_TEAM"))).toBe(true);
  });

  it("نقصُ لغةٍ واحدةٍ يُسقِطُ الحاجزَ — الثلاثةُ سواءٌ", () => {
    const partial = { ...dictionary() };
    delete partial["rider.sos.disclosure.SOS_SHARES_ROLE"];
    const problems = disclosureTextProblems(
      input({ translations: { ar: dictionary(), en: dictionary(), ur: partial } }),
    );
    expect(problems.some((text) => text.startsWith("ur:"))).toBe(true);
  });

  it("قائمةُ رموزٍ فارغةٌ تُسقِطُ الحاجزَ ولا تمرُّ زوراً", () => {
    const problems = disclosureTextProblems(input({ disclosureCodes: [] }));
    expect(problems.some((text) => text.includes("قائمةٍ فارغةٍ"))).toBe(true);
  });
});

describe("القاعدة ٣ — نفيُ الاتّصالِ منشورٌ في كلِّ حالٍ", () => {
  it("مجالٌ بلا «SOS_NO_PHONE_CALL» يُسقِطُ الحاجزَ", () => {
    const problems = mandatoryDisclosureProblems(input({ disclosureCodes: ["SOS_SHARES_ROLE"] }));
    expect(problems.some((text) => text.includes("ليسَ في مجالِ الإفصاحِ"))).toBe(true);
  });

  it("هجرةٌ لا تنشرُ الرمزَ تُسقِطُ الحاجزَ — رمزٌ لا يُرسَلُ لا يُعرَضُ", () => {
    const problems = mandatoryDisclosureProblems(
      input({ sql: SQL.replace(", 'SOS_NO_PHONE_CALL'", "") }),
    );
    expect(problems.some((text) => text.includes("لا تنشرُ"))).toBe(true);
  });
});

/**
 * ولمَ يُمنَعُ حسابُ العُمرِ في المتصفّحِ: ساعةُ الجهازِ تُضبَطُ يدوياً وتنحرفُ.
 * فنموذجٌ يحسبُ «أُرسِلَ قبلَ ساعةٍ» عن بلاغٍ أُرسِلَ قبلَ دقيقةٍ يدفعُ صاحبَه
 * إلى إعادةِ الإرسالِ أو إلى اليأسِ — وكلاهما ضررٌ في اللحظةِ الحرجةِ.
 */
describe("القاعدة ٤ — لا ساعةَ جهازٍ في العُمرِ", () => {
  it("«Date.now» في نموذجِ العرضِ يُسقِطُ الحاجزَ", () => {
    const problems = deviceClockProblems(
      input({
        surface: { ...input().surface, [VIEW_FILE]: "const age = Date.now() - openedAt;" },
      }),
    );
    expect(problems.some((text) => text.includes("Date.now"))).toBe(true);
  });

  it("«new Date» في نموذجِ العرضِ يُسقِطُ الحاجزَ", () => {
    const problems = deviceClockProblems(
      input({ surface: { ...input().surface, [VIEW_FILE]: "const d = new Date(stamp);" } }),
    );
    expect(problems.some((text) => text.includes("new Date"))).toBe(true);
  });

  it("نموذجُ عرضٍ غائبٌ يُسقِطُ الحاجزَ ولا يمرُّ بمِلفٍّ ناقصٍ", () => {
    const problems = deviceClockProblems(input({ surface: {} }));
    expect(problems.some((text) => text.includes("لم يُقرأْ نموذجُ العرضِ"))).toBe(true);
  });
});

describe("القاعدة ٥ — لا مُعرِّفَ طلبٍ من الشاشةِ", () => {
  it("مسارٌ يُركِّبُ مُعرِّفاً في النداءِ يُسقِطُ الحاجزَ", () => {
    const problems = orderIdInPathProblems(
      input({
        surface: {
          ...input().surface,
          [API_FILE]: "return apiFetch(`/v1/safety/sos/${id}`, { method: 'POST' });",
        },
      }),
    );
    expect(problems.some((text) => text.includes("يُركِّبُ قيمةً من العميلِ"))).toBe(true);
  });

  it("ذكرُ «orderId» في النداءِ يُسقِطُ الحاجزَ", () => {
    const problems = orderIdInPathProblems(
      input({
        surface: {
          ...input().surface,
          [API_FILE]: "export async function triggerSos(orderId: string) { return orderId; }",
        },
      }),
    );
    expect(problems.some((text) => text.includes("مُعرِّفَ طلبٍ"))).toBe(true);
  });

  it("مِلفُّ نداءٍ غائبٌ يُسقِطُ الحاجزَ", () => {
    const problems = orderIdInPathProblems(input({ surface: {} }));
    expect(problems.some((text) => text.includes("لم يُقرأْ مِلفُّ النداءِ"))).toBe(true);
  });
});

describe("القاعدة ٦ — لا دالّةَ بلا نزعِ تنفيذٍ", () => {
  it("دالّةٌ بلا نزعٍ تُسقِطُ الحاجزَ", () => {
    const problems = functionRevokeProblems(
      input({
        sql: SQL.replace(
          "revoke execute on function sos_surface_state(bigint, text) from public, anon, authenticated;",
          "",
        ),
      }),
    );
    expect(problems.some((text) => text.includes("sos_surface_state"))).toBe(true);
  });

  it("نزعٌ ناقصُ الأدوارِ يُسقِطُ الحاجزَ", () => {
    const problems = functionRevokeProblems(
      input({
        sql: SQL.replace(
          "revoke execute on function sos_surface_state(bigint, text) from public, anon, authenticated;",
          "revoke execute on function sos_surface_state(bigint, text) from public;",
        ),
      }),
    );
    expect(problems.some((text) => text.includes("anon"))).toBe(true);
  });

  it("هجرةٌ بلا دالّةٍ تُسقِطُ الحاجزَ ولا تمرُّ زوراً", () => {
    const problems = functionRevokeProblems(input({ sql: "select 1;" }));
    expect(problems.some((text) => text.includes("قائمةٍ فارغةٍ"))).toBe(true);
  });
});
