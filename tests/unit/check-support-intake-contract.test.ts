/**
 * الغرض: قياسُ حاجزِ عقدِ سطحِ الدعمِ — **حالةٌ سلبيّةٌ مبذورةٌ لكلِّ قاعدةٍ من
 *   السبعِ** (`ح-7`: قاعدةٌ بلا حالةٍ سلبيّةٍ غيرُ مُنفَذةٍ).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * ولماذا تُقاسُ مدخلاتٌ مصنوعةٌ والمستودعُ معاً: المستودعُ اليومَ نظيفٌ، فلو
 * قِيسَ وحدَه لَنجحَ الاختبارُ ولو كانَ الحاجزُ لا يفحصُ شيئاً. **والحاجزُ الذي
 * لم يُرَ ساقطاً مرّةً لا يُعرَفُ أنّه يقفُ.**
 */

import { describe, expect, it } from "bun:test";
import { readRepository } from "../../scripts/check-support-intake-contract.ts";
import {
  fallbackKeyProblems,
  functionRevokeProblems,
  keyParityProblems,
  referenceDisplayProblems,
  referenceShapeProblems,
  SCREEN_FILE,
  type SupportIntakeContractInput,
  supportIntakeContractProblems,
  textCoverageProblems,
  uploadAffordanceProblems,
} from "../../scripts/lib/support-intake-contract.ts";

const SQL = `
create sequence if not exists support_ticket_reference_seq;
alter table support_tickets add column if not exists reference text
  default 'WSL-' || lpad(nextval('support_ticket_reference_seq')::text, 6, '0');

create or replace function public.open_support_ticket(
  p_telegram_id bigint, p_type support_ticket_type, p_message text, p_note text, p_order_id uuid
) returns jsonb as $$ begin end; $$ language plpgsql;

create or replace function public.rider_support_tickets(
  p_telegram_id bigint, p_limit integer, p_before_created_at timestamptz, p_before_id uuid
) returns jsonb as $$ begin end; $$ language plpgsql;

revoke execute on function public.open_support_ticket(bigint, support_ticket_type, text, text, uuid)
  from public, anon, authenticated;
revoke execute on function public.rider_support_tickets(bigint, integer, timestamptz, uuid)
  from public, anon, authenticated;
`;

const SCREEN = `
const t = miniAppTranslator(language);
return <p className="sup__reference">{opened.reference}</p>;
`;

/** قاموسٌ كاملٌ مصنوعٌ — يُبنى من المجالاتِ كي لا يتخلَّفَ عن قاعدةٍ تُزادُ. */
function dictionary(
  categories: readonly string[],
  statuses: readonly string[],
  codes: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {
    "rider.support.error.UNKNOWN": "تعثَّرَ",
    "rider.support.category.unknown": "غيرُ معروفٍ",
    "rider.support.status.unknown": "غيرُ معروفةٍ",
    "rider.support.category.subscription": "اشتراكٌ",
  };
  for (const c of categories) out[`rider.support.category.${c}`] = c;
  for (const s of statuses) out[`rider.support.status.${s}`] = s;
  for (const c of codes) out[`rider.support.error.${c}`] = c;
  return out;
}

const CATEGORIES = ["ride_dispute", "lost_item"] as const;
const STATUSES = ["open", "resolved"] as const;
const CODES = ["MESSAGE_EMPTY", "COOLDOWN_ACTIVE"] as const;

function baseInput(): SupportIntakeContractInput {
  const dict = dictionary(CATEGORIES, STATUSES, CODES);
  return {
    surface: { [SCREEN_FILE]: SCREEN },
    sql: SQL,
    translations: { ar: { ...dict }, en: { ...dict }, ur: { ...dict } },
    categories: [...CATEGORIES],
    statuses: [...STATUSES],
    errorCodes: [...CODES],
    referencePattern: /^WSL-[0-9]{6,}$/,
  };
}

function withDictionary(
  input: SupportIntakeContractInput,
  language: string,
  change: (dict: Record<string, string>) => void,
): SupportIntakeContractInput {
  const dict = { ...(input.translations[language] ?? {}) };
  change(dict);
  return { ...input, translations: { ...input.translations, [language]: dict } };
}

describe("عقدُ سطحِ الدعمِ — المدخلُ النظيفُ يمرُّ", () => {
  it("لا خرقَ في المدخلِ المصنوعِ الكاملِ", () => {
    expect(supportIntakeContractProblems(baseInput())).toEqual([]);
  });
});

describe("القاعدة ١ — لا رمزَ بلا نصٍّ", () => {
  it("تسقطُ حينَ يغيبُ نصُّ رمزِ عطبٍ عن قاموسٍ واحدٍ", () => {
    const input = withDictionary(baseInput(), "ur", (dict) => {
      delete dict["rider.support.error.COOLDOWN_ACTIVE"];
    });
    const problems = textCoverageProblems(input);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toContain("COOLDOWN_ACTIVE");
  });

  it("تسقطُ حينَ يغيبُ نصُّ صنفٍ يُقرأُ ولا يُختارُ", () => {
    const input = withDictionary(baseInput(), "en", (dict) => {
      delete dict["rider.support.category.subscription"];
    });
    expect(textCoverageProblems(input).join("\n")).toContain("subscription");
  });

  it("لا تمرُّ بمجالٍ فارغٍ", () => {
    const problems = textCoverageProblems({ ...baseInput(), errorCodes: [] });
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe("القاعدة ٢ — تطابقُ مفاتيحِ القواميسِ", () => {
  it("تسقطُ على مفتاحٍ زائدٍ في لغةٍ واحدةٍ", () => {
    const input = withDictionary(baseInput(), "en", (dict) => {
      dict["rider.support.form.extra"] = "extra";
    });
    expect(keyParityProblems(input).join("\n")).toContain("زائدٌ");
  });

  it("تسقطُ على مفتاحٍ ناقصٍ في لغةٍ واحدةٍ", () => {
    const input = withDictionary(baseInput(), "ur", (dict) => {
      delete dict["rider.support.status.open"];
    });
    expect(keyParityProblems(input).join("\n")).toContain("ناقصٌ");
  });
});

describe("القاعدة ٣ — سقوطٌ للرمزِ المجهولِ", () => {
  it("تسقطُ حينَ يغيبُ مفتاحُ السقوطِ", () => {
    const input = withDictionary(baseInput(), "ar", (dict) => {
      delete dict["rider.support.error.UNKNOWN"];
    });
    expect(fallbackKeyProblems(input).join("\n")).toContain("rider.support.error.UNKNOWN");
  });
});

describe("القاعدة ٤ — المرجعُ منطوقٌ لا UUID", () => {
  it("تسقطُ على نمطٍ يقبلُ UUID", () => {
    const input = { ...baseInput(), referencePattern: /^[0-9a-f-]+$/ };
    expect(referenceShapeProblems(input).join("\n")).toContain("UUID");
  });

  it("تسقطُ على نمطٍ لا يقبلُ المرجعَ المنطوقَ", () => {
    const input = { ...baseInput(), referencePattern: /^TICKET-[0-9]+$/ };
    expect(referenceShapeProblems(input).length).toBeGreaterThan(0);
  });

  it("تسقطُ حينَ لا متسلسلةَ في الهجرةِ", () => {
    const input = { ...baseInput(), sql: SQL.replace(/support_ticket_reference_seq/g, "some_seq") };
    expect(referenceShapeProblems(input).join("\n")).toContain("متسلسلة");
  });

  it("تسقطُ حينَ يُولَّدُ المرجعُ UUID في الهجرةِ", () => {
    const input = {
      ...baseInput(),
      sql: `${SQL}\nalter table support_tickets alter column reference set default gen_random_uuid()::text;`,
    };
    expect(referenceShapeProblems(input).join("\n")).toContain("ADR 0114");
  });
});

describe("القاعدة ٥ — المرجعُ يُعرَضُ", () => {
  it("تسقطُ على شاشةٍ تقولُ «تمَّ» ولا تعرضُ رقماً", () => {
    const input = {
      ...baseInput(),
      surface: { [SCREEN_FILE]: 'return <p>{t("rider.support.opened.lead")}</p>;' },
    };
    expect(referenceDisplayProblems(input).length).toBe(1);
  });

  it("لا تمرُّ بمِلفٍّ غائبٍ", () => {
    expect(referenceDisplayProblems({ ...baseInput(), surface: {} }).length).toBe(1);
  });
});

describe("القاعدة ٦ — لا بابَ إرفاقٍ صوريَّ", () => {
  it("تسقطُ على حقلِ ملفٍّ في الشاشةِ", () => {
    const input = {
      ...baseInput(),
      surface: { [SCREEN_FILE]: `${SCREEN}\n<input type="file" />` },
    };
    expect(uploadAffordanceProblems(input).join("\n")).toContain("إرفاق");
  });

  it("تسقطُ على بناءِ FormData في السطحِ", () => {
    const input = {
      ...baseInput(),
      surface: { [SCREEN_FILE]: `${SCREEN}\nconst body = new FormData();` },
    };
    expect(uploadAffordanceProblems(input).length).toBeGreaterThan(0);
  });
});

describe("القاعدة ٧ — لا دالّةَ بلا نزعِ تنفيذٍ", () => {
  it("تسقطُ حينَ تُنشأُ دالّةٌ ولا يُنزَعُ تنفيذُها", () => {
    const input = {
      ...baseInput(),
      sql: SQL.replace(
        "revoke execute on function public.rider_support_tickets(bigint, integer, timestamptz, uuid)\n  from public, anon, authenticated;",
        "",
      ),
    };
    expect(functionRevokeProblems(input).join("\n")).toContain("rider_support_tickets");
  });

  it("تسقطُ على نزعٍ ناقصِ الأدوارِ", () => {
    const input = {
      ...baseInput(),
      sql: SQL.replace("from public, anon, authenticated;", "from anon;"),
    };
    expect(functionRevokeProblems(input).join("\n")).toContain("public");
  });

  it("لا تمرُّ بهجرةٍ بلا دالّةٍ", () => {
    expect(functionRevokeProblems({ ...baseInput(), sql: "select 1;" }).length).toBe(1);
  });
});

describe("المستودعُ الحقيقيُّ", () => {
  it("يمرُّ بلا خرقٍ", () => {
    expect(supportIntakeContractProblems(readRepository())).toEqual([]);
  });
});
