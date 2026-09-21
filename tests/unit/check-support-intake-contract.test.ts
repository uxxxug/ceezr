/**
 * الغرض: قياسُ حاجزِ عقدِ سطحِ الدعمِ — **حالةٌ سلبيّةٌ مبذورةٌ لكلِّ قاعدةٍ من
 *   السبعِ** (`ح-7`: قاعدةٌ بلا حالةٍ سلبيّةٍ غيرُ مُنفَذةٍ).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`، ومُوسَّعٌ في `F3-08` · `SD-10`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * وزيادةُ `SD-10`: القواعدُ صارَت تُقاسُ على **دورَينِ** وعلى **هجراتٍ عدّةٍ**،
 * فزِيدَت حالاتٌ سلبيّةٌ للبُعدَينِ الجديدَينِ: نصٌّ ناقصٌ في بادئةِ السائقِ وحدَها،
 * وصنفُ سائقٍ لا نصَّ له عندَ الراكبِ الذي يقرؤه، ودالّةٌ في **الهجرةِ الثانيةِ**
 * لا يُنزَعُ تنفيذُها. **وبُعدٌ يُزادُ بلا حالةٍ سلبيّةٍ زيادةٌ غيرُ مُنفَذةٍ.**
 *
 * ولماذا تُقاسُ مدخلاتٌ مصنوعةٌ والمستودعُ معاً: المستودعُ اليومَ نظيفٌ، فلو
 * قِيسَ وحدَه لَنجحَ الاختبارُ ولو كانَ الحاجزُ لا يفحصُ شيئاً. **والحاجزُ الذي
 * لم يُرَ ساقطاً مرّةً لا يُعرَفُ أنّه يقفُ.**
 */

import { describe, expect, it } from "bun:test";
import { readRepository } from "../../scripts/check-support-intake-contract.ts";
import {
  answerPathProblems,
  fallbackKeyProblems,
  functionRevokeProblems,
  keyParityProblems,
  referenceDisplayProblems,
  referenceShapeProblems,
  SCREEN_FILE,
  type SupportIntakeContractInput,
  type SupportRoleScope,
  supportIntakeContractProblems,
  textCoverageProblems,
  uploadAffordanceProblems,
} from "../../scripts/lib/support-intake-contract.ts";

const REFERENCE_SQL_PATH = "supabase/migrations/0001_reference.sql";
const DRIVER_SQL_PATH = "supabase/migrations/0002_driver.sql";

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

/** هجرةٌ ثانيةٌ تُعيدُ إنشاءَ دالّةٍ — و`create or replace` يُعيدُ المنحَ ضمنيّاً. */
const DRIVER_SQL = `
create or replace function public.driver_support_tickets(
  p_telegram_id bigint, p_limit integer, p_before_created_at timestamptz, p_before_id uuid
) returns jsonb as $$ begin end; $$ language plpgsql;

revoke execute on function public.driver_support_tickets(bigint, integer, timestamptz, uuid)
  from public, anon, authenticated;
`;

const SCREEN = `
const t = miniAppTranslator(language);
return <p className="sup__reference">{opened.reference}</p>;
`;

const STATUSES = ["open", "resolved"] as const;
const CODES = ["MESSAGE_EMPTY", "COOLDOWN_ACTIVE"] as const;

/** دورانِ مصنوعانِ — أصنافُ كلٍّ منهما مقروءةٌ عندَ الآخرِ كما في الواقعِ. */
const ROLES: readonly SupportRoleScope[] = [
  {
    label: "الراكبُ",
    keyPrefix: "rider.support.",
    selectable: ["ride_dispute", "lost_item"],
    readOnly: ["subscription", "deduction"],
  },
  {
    label: "السائقُ",
    keyPrefix: "driver.support.",
    selectable: ["subscription", "deduction"],
    readOnly: ["ride_dispute"],
  },
];

/** قاموسٌ كاملٌ مصنوعٌ — يُبنى من المجالاتِ كي لا يتخلَّفَ عن قاعدةٍ تُزادُ. */
function dictionary(
  roles: readonly SupportRoleScope[],
  statuses: readonly string[],
  codes: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of roles) {
    out[`${role.keyPrefix}error.UNKNOWN`] = "تعثَّرَ";
    out[`${role.keyPrefix}category.unknown`] = "غيرُ معروفٍ";
    out[`${role.keyPrefix}status.unknown`] = "غيرُ معروفةٍ";
    for (const c of [...role.selectable, ...role.readOnly]) {
      out[`${role.keyPrefix}category.${c}`] = c;
    }
    for (const s of statuses) out[`${role.keyPrefix}status.${s}`] = s;
    for (const c of codes) out[`${role.keyPrefix}error.${c}`] = c;
  }
  return out;
}

function baseInput(): SupportIntakeContractInput {
  const dict = dictionary(ROLES, STATUSES, CODES);
  return {
    surface: { [SCREEN_FILE]: SCREEN },
    sql: SQL,
    sqlByPath: { [REFERENCE_SQL_PATH]: SQL, [DRIVER_SQL_PATH]: DRIVER_SQL },
    translations: { ar: { ...dict }, en: { ...dict }, ur: { ...dict } },
    roles: ROLES,
    statuses: [...STATUSES],
    errorCodes: [...CODES],
    referencePattern: /^WSL-[0-9]{6,}$/,
    botDictionaries: { ar: botDictionary(), en: botDictionary(), ur: botDictionary() },
    notifierSource: NOTIFIER,
    supportDialogSource: SUPPORT_DIALOG,
    driverDialogSource: DRIVER_DIALOG,
    ticketEntitySource: TICKET_ENTITY,
    answerSql: ANSWER_SQL,
  };
}

/** قاموسُ بوتٍ سليمٌ — الوعدُ ونصوصُ الأفعالِ الأربعةِ، وموضعُ المكتوبِ في الردِّ. */
function botDictionary(): Record<string, string> {
  return {
    "support.ticket_created": "وصلت شكواك — سيصلك الردّ هنا.",
    "support.resolved_activated": "فُعِّل اشتراكك.",
    "support.resolved_terminated": "أُنهي اشتراكك.",
    "support.resolved_rejected": "لم يُقبل طلبك.",
    "support.resolved_answered": "ردّ الدعم:\n\n{answer}",
  };
}

function withBotDictionary(
  input: SupportIntakeContractInput,
  language: string,
  change: (dict: Record<string, string>) => void,
): SupportIntakeContractInput {
  const dict = { ...(input.botDictionaries[language] ?? {}) };
  change(dict);
  return { ...input, botDictionaries: { ...input.botDictionaries, [language]: dict } };
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

const NOTIFIER = `
function resolutionKey(action) {
  if (action === "activate") return "support.resolved_activated";
  if (action === "terminate") return "support.resolved_terminated";
  if (action === "answer") return "support.resolved_answered";
  return "support.resolved_rejected";
}
const text = input.action === "answer" ? tr(key, { answer: input.note ?? "" }) : tr(key);
`;

const SUPPORT_DIALOG = `
export async function handleAnswerCommand(command, sender, state, deps) { return []; }
`;

const DRIVER_DIALOG = `
    case "/answer": {
      return handleAnswerCommand(command, sender, state, deps.support);
    }
`;

const TICKET_ENTITY = `
  if (canClaim(ticket.status)) actions.push("claim");
  actions.push("reject");
`;

const ANSWER_SQL = `
  if p_action not in ('activate', 'terminate', 'reject', 'answer') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_ACTION');
  end if;
  if p_action = 'answer' and v_note is null then
    return jsonb_build_object('ok', false, 'error', 'ANSWER_NOTE_REQUIRED');
  end if;
  if p_action in ('activate', 'terminate') and v_ticket.driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'TICKET_HAS_NO_DRIVER');
  end if;
    v_payload := v_delivery.payload || jsonb_build_object(
      'owner_kind', v_owner_kind,
      'resolution', v_resolution
    );
`;

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

  it("تسقطُ حينَ يغيبُ نصٌّ في بادئةِ السائقِ وحدَها", () => {
    const input = withDictionary(baseInput(), "ar", (dict) => {
      delete dict["driver.support.category.deduction"];
    });
    const problems = textCoverageProblems(input);
    expect(problems.join("\n")).toContain("driver.support.category.deduction");
    expect(problems.join("\n")).toContain("السائقُ");
  });

  it("تسقطُ حينَ يقرأُ الراكبُ صنفَ سائقٍ بلا نصٍّ عندَه", () => {
    const input = withDictionary(baseInput(), "en", (dict) => {
      delete dict["rider.support.category.deduction"];
    });
    expect(textCoverageProblems(input).join("\n")).toContain("rider.support.category.deduction");
  });

  it("لا تمرُّ بمجالٍ فارغٍ", () => {
    const problems = textCoverageProblems({ ...baseInput(), errorCodes: [] });
    expect(problems.length).toBeGreaterThan(0);
  });

  it("لا تمرُّ بقائمةِ أدوارٍ فارغةٍ", () => {
    expect(textCoverageProblems({ ...baseInput(), roles: [] }).length).toBeGreaterThan(0);
  });

  it("لا تمرُّ بدورٍ بلا صنفٍ يُختارُ", () => {
    const roles: readonly SupportRoleScope[] = [
      { label: "دورٌ فارغٌ", keyPrefix: "driver.support.", selectable: [], readOnly: [] },
    ];
    expect(textCoverageProblems({ ...baseInput(), roles }).length).toBeGreaterThan(0);
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

  it("تسقطُ على خللِ تطابقٍ في بادئةِ السائقِ وحدَها", () => {
    const input = withDictionary(baseInput(), "en", (dict) => {
      dict["driver.support.form.extra"] = "extra";
    });
    expect(keyParityProblems(input).join("\n")).toContain("driver.support.form.extra");
  });

  it("تسقطُ حينَ تخلو العربيّةُ من بادئةِ دورٍ كاملةٍ", () => {
    const input = withDictionary(baseInput(), "ar", (dict) => {
      for (const key of Object.keys(dict)) {
        if (key.startsWith("driver.support.")) delete dict[key];
      }
    });
    expect(keyParityProblems(input).join("\n")).toContain("driver.support.");
  });
});

describe("القاعدة ٣ — سقوطٌ للرمزِ المجهولِ", () => {
  it("تسقطُ حينَ يغيبُ مفتاحُ السقوطِ", () => {
    const input = withDictionary(baseInput(), "ar", (dict) => {
      delete dict["rider.support.error.UNKNOWN"];
    });
    expect(fallbackKeyProblems(input).join("\n")).toContain("rider.support.error.UNKNOWN");
  });

  it("تسقطُ حينَ يغيبُ مفتاحُ سقوطِ السائقِ", () => {
    const input = withDictionary(baseInput(), "ur", (dict) => {
      delete dict["driver.support.category.unknown"];
    });
    expect(fallbackKeyProblems(input).join("\n")).toContain("driver.support.category.unknown");
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
    const base = baseInput();
    const input = {
      ...base,
      sqlByPath: {
        ...base.sqlByPath,
        [REFERENCE_SQL_PATH]: SQL.replace(
          "revoke execute on function public.rider_support_tickets(bigint, integer, timestamptz, uuid)\n  from public, anon, authenticated;",
          "",
        ),
      },
    };
    const problems = functionRevokeProblems(input).join("\n");
    expect(problems).toContain("rider_support_tickets");
    expect(problems).toContain(REFERENCE_SQL_PATH);
  });

  it("تسقطُ على نزعٍ ناقصِ الأدوارِ", () => {
    const base = baseInput();
    const input = {
      ...base,
      sqlByPath: {
        ...base.sqlByPath,
        [REFERENCE_SQL_PATH]: SQL.replace("from public, anon, authenticated;", "from anon;"),
      },
    };
    expect(functionRevokeProblems(input).join("\n")).toContain("public");
  });

  it("تسقطُ على دالّةٍ في الهجرةِ **الثانيةِ** بلا نزعٍ", () => {
    const base = baseInput();
    const input = {
      ...base,
      sqlByPath: {
        ...base.sqlByPath,
        [DRIVER_SQL_PATH]: DRIVER_SQL.replace(/revoke execute[\s\S]*$/, ""),
      },
    };
    const problems = functionRevokeProblems(input).join("\n");
    expect(problems).toContain("driver_support_tickets");
    expect(problems).toContain(DRIVER_SQL_PATH);
  });

  it("تمرُّ على هجرةِ أصنافٍ لا تُنشئُ دالّةً معَ هجرةٍ تُنشئُ وتنزعُ", () => {
    const base = baseInput();
    const input = {
      ...base,
      sqlByPath: {
        ...base.sqlByPath,
        "supabase/migrations/0003_enum.sql": "alter type support_ticket_type add value 'vehicle';",
      },
    };
    expect(functionRevokeProblems(input)).toEqual([]);
  });

  it("لا تمرُّ بهجراتٍ بلا دالّةٍ واحدةٍ", () => {
    const input = { ...baseInput(), sqlByPath: { [REFERENCE_SQL_PATH]: "select 1;" } };
    expect(functionRevokeProblems(input).length).toBe(1);
  });

  it("لا تمرُّ بقائمةِ هجراتٍ فارغةٍ", () => {
    expect(functionRevokeProblems({ ...baseInput(), sqlByPath: {} }).length).toBe(1);
  });
});

describe("القاعدة ٨ — الوعدُ بردٍّ يقتضي مسارَ ردٍّ", () => {
  it("المدخلُ السليمُ يمرُّ — فالقاعدةُ لا تمنعُ الصوابَ", () => {
    expect(answerPathProblems(baseInput())).toEqual([]);
  });

  it("لا تمرُّ بمجالِ قواميسَ فارغٍ", () => {
    expect(answerPathProblems({ ...baseInput(), botDictionaries: {} }).length).toBe(1);
  });

  for (const language of ["ar", "en", "ur"]) {
    it(`تسقُطُ متى تعذَّرَ قاموسُ «${language}» — لا خضرةَ عن تعذُّرِ قراءةٍ`, () => {
      const input = baseInput();
      const problems = answerPathProblems({
        ...input,
        botDictionaries: { ...input.botDictionaries, [language]: null },
      });
      expect(problems.some((p) => p.includes(language))).toBe(true);
    });

    it(`تسقُطُ متى غابَ نصُّ الردِّ في «${language}»`, () => {
      const input = withBotDictionary(baseInput(), language, (d) => {
        delete d["support.resolved_answered"];
      });
      expect(answerPathProblems(input).some((p) => p.includes("resolved_answered"))).toBe(true);
    });

    it(`تسقُطُ متى غابَ وعدُ الاستلامِ في «${language}»`, () => {
      const input = withBotDictionary(baseInput(), language, (d) => {
        delete d["support.ticket_created"];
      });
      expect(answerPathProblems(input).some((p) => p.includes("ticket_created"))).toBe(true);
    });

    it(`تسقُطُ متى كانَ نصُّ الردِّ فراغاً في «${language}»`, () => {
      const input = withBotDictionary(baseInput(), language, (d) => {
        d["support.resolved_answered"] = "   ";
      });
      expect(answerPathProblems(input).length).toBeGreaterThan(0);
    });

    it(`تسقُطُ متى خلا نصُّ الردِّ من موضعِ المكتوبِ في «${language}» — وهوَ العطبُ بعينِه`, () => {
      const input = withBotDictionary(baseInput(), language, (d) => {
        d["support.resolved_answered"] = "راجع الدعم تذكرتك وأُقفلت.";
      });
      expect(answerPathProblems(input).some((p) => p.includes("{answer}"))).toBe(true);
    });
  }

  it("تسقُطُ متى تعذَّرَ المُبلِّغُ", () => {
    const problems = answerPathProblems({ ...baseInput(), notifierSource: null });
    expect(problems.some((p) => p.includes("مُبلِّغُ القرارِ لم يُقرأْ"))).toBe(true);
  });

  it("تسقُطُ متى لم يذكرِ المُبلِّغُ مفتاحَ الردِّ — نصٌّ لا يُنادى بهِ أحدٌ", () => {
    const input = baseInput();
    const problems = answerPathProblems({
      ...input,
      notifierSource: (input.notifierSource ?? "").replace('"support.resolved_answered"', '"x"'),
    });
    expect(problems.some((p) => p.includes("support.resolved_answered"))).toBe(true);
  });

  it("تسقُطُ متى لم يُمرِّرِ المُبلِّغُ المكتوبَ — وهوَ عطبُ ما قبلَ الخطوةِ ١٠", () => {
    const input = baseInput();
    const problems = answerPathProblems({
      ...input,
      notifierSource: (input.notifierSource ?? "").replace("input.note", '""'),
    });
    expect(problems.some((p) => p.includes("input.note"))).toBe(true);
  });

  it("تسقُطُ متى تعذَّرَت الهجرةُ", () => {
    expect(
      answerPathProblems({ ...baseInput(), answerSql: null }).some((p) =>
        p.includes("هجرةُ الردِّ لم تُقرأْ"),
      ),
    ).toBe(true);
  });

  it("تسقُطُ متى لم تُوجِبِ القاعدةُ نصّاً للردِّ", () => {
    const input = baseInput();
    const problems = answerPathProblems({
      ...input,
      answerSql: (input.answerSql ?? "").replaceAll("ANSWER_NOTE_REQUIRED", "OK"),
    });
    expect(problems.some((p) => p.includes("ANSWER_NOTE_REQUIRED"))).toBe(true);
  });

  it("تسقُطُ متى غابَ الفعلُ نفسُه من الهجرةِ", () => {
    const input = baseInput();
    const problems = answerPathProblems({
      ...input,
      answerSql: (input.answerSql ?? "").replaceAll("'answer'", "'x'"),
    });
    expect(problems.length).toBeGreaterThan(0);
  });

  it("تسقُطُ متى اشترطَ الردُّ سائقاً — فتذكرةُ راكبٍ لا مخرجَ لها إلّا الرفضُ", () => {
    const input = baseInput();
    const problems = answerPathProblems({
      ...input,
      answerSql: (input.answerSql ?? "").replace(
        "if p_action in ('activate', 'terminate') and v_ticket.driver_id is null then",
        "if p_action in ('activate', 'terminate', 'answer') and v_ticket.driver_id is null then",
      ),
    });
    expect(problems.some((p) => p.includes("تشترطُ سائقاً"))).toBe(true);
  });

  it("تسقُطُ متى لم تُلحِقْ حمولةُ الالتقاطِ المكتوبَ", () => {
    const input = baseInput();
    const problems = answerPathProblems({
      ...input,
      answerSql: (input.answerSql ?? "").replace("'resolution', v_resolution", "'x', 1"),
    });
    expect(problems.some((p) => p.includes("حمولةِ الالتقاطِ"))).toBe(true);
  });

  it("تسقُطُ متى تعذَّرَ مُوزِّعُ الدعمِ", () => {
    expect(
      answerPathProblems({ ...baseInput(), supportDialogSource: null }).some((p) =>
        p.includes("مُوزِّعُ الدعمِ لم يُقرأْ"),
      ),
    ).toBe(true);
  });

  it("تسقُطُ متى غابَ مَسلَكُ الردِّ — فعلٌ لا مَسلَكَ له لا يستعملُه أحدٌ", () => {
    expect(
      answerPathProblems({ ...baseInput(), supportDialogSource: "export {};" }).some((p) =>
        p.includes("handleAnswerCommand"),
      ),
    ).toBe(true);
  });

  it("تسقُطُ متى تعذَّرَ مُوزِّعُ السائقِ", () => {
    expect(
      answerPathProblems({ ...baseInput(), driverDialogSource: null }).some((p) =>
        p.includes("مُوزِّعُ السائقِ لم يُقرأْ"),
      ),
    ).toBe(true);
  });

  it("تسقُطُ متى كانَ المَسلَكُ مكتوباً غيرَ مُوصَّلٍ", () => {
    expect(
      answerPathProblems({ ...baseInput(), driverDialogSource: "switch (command) {}" }).some((p) =>
        p.includes("/answer"),
      ),
    ).toBe(true);
  });

  it("تسقُطُ متى تعذَّرَ كِيانُ التذكرةِ", () => {
    expect(
      answerPathProblems({ ...baseInput(), ticketEntitySource: null }).some((p) =>
        p.includes("كِيانُ التذكرةِ لم يُقرأْ"),
      ),
    ).toBe(true);
  });

  it("تسقُطُ متى عُرِضَ الردُّ زرّاً — وزرٌّ لا يحملُ نصّاً لا يَرُدُّ", () => {
    const input = baseInput();
    const problems = answerPathProblems({
      ...input,
      ticketEntitySource: `${input.ticketEntitySource ?? ""}\n  actions.push("answer");`,
    });
    expect(problems.some((p) => p.includes("يعرضُ الردَّ زرّاً"))).toBe(true);
  });

  it("لا تسقُطُ على زرٍّ آخرَ يُدفَعُ — فالحكمُ على الردِّ وحدَه", () => {
    const input = baseInput();
    const problems = answerPathProblems({
      ...input,
      ticketEntitySource: `${input.ticketEntitySource ?? ""}\n  actions.push("terminate");`,
    });
    expect(problems).toEqual([]);
  });

  it("لا تسقُطُ على ذِكرِ «answer» في سطرٍ لا يُنشئُ زرّاً", () => {
    const input = baseInput();
    const problems = answerPathProblems({
      ...input,
      ticketEntitySource: `${input.ticketEntitySource ?? ""}\n  // "answer" لا زرَّ له`,
    });
    expect(problems).toEqual([]);
  });
});

describe("المستودعُ الحقيقيُّ", () => {
  it("يمرُّ بلا خرقٍ", () => {
    expect(supportIntakeContractProblems(readRepository())).toEqual([]);
  });
});
