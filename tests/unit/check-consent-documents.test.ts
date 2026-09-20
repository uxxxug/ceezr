/**
 * الغرض: إثباتُ أنَّ حاجزَ وثائقِ الموافقةِ **يُخفِقُ فعلاً** على كلِّ افتراقٍ
 *   يدّعي منعَه — لا أنَّه يمرُّ على المستودعِ كما هوَ اليومَ (`F2-01`).
 * الحالة: اختبار فعلي — يُستورَدُ الحاجزُ ويُستدعى على مُدخلاتٍ مُصنَّعةٍ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: حينَ يُوسَّعُ الحاجزُ ليقرأَ سائرَ شاشاتِ التطبيقِ يُضافُ
 *   اختبارٌ سالبٌ لكلِّ قاعدةٍ جديدةٍ — قاعدةٌ بلا اختبارٍ سالبٍ تغطيةٌ مُدَّعاةٌ.
 */

import { describe, expect, it } from "bun:test";
import {
  DECLARED_CONSENT_DOCUMENTS,
  DECLARED_CONSENT_KINDS,
} from "../../packages/domain/consent/consent-documents.ts";
import {
  findViolations,
  kindsFromConstraint,
  type RepositoryInput,
  readRepository,
} from "../../scripts/check-consent-documents.ts";

const LANGUAGES = ["ar", "en", "ur"] as const;

function fullDictionaries(): Record<string, Record<string, string>> {
  const dictionaries: Record<string, Record<string, string>> = {};
  for (const language of LANGUAGES) {
    const dictionary: Record<string, string> = {};
    for (const document of DECLARED_CONSENT_DOCUMENTS) {
      dictionary[document.titleKey] = `${document.kind} title ${language}`;
      dictionary[document.summaryKey] = `${document.kind} summary ${language}`;
      dictionary[document.textKey] = `${document.kind} text ${language}`;
    }
    dictionaries[language] = dictionary;
  }
  return dictionaries;
}

function migrationWith(kinds: readonly string[]): string {
  const list = kinds.map((kind) => `'${kind}'`).join(", ");
  return `-- migration-phase: expand\ncreate table if not exists user_consents (\n  kind text not null check (kind in (${list}))\n);\n`;
}

function input(overrides: Partial<RepositoryInput> = {}): RepositoryInput {
  return {
    migrationSql: migrationWith([...DECLARED_CONSENT_KINDS]),
    miniappDictionaries: fullDictionaries(),
    botDictionaries: { ar: {}, en: {}, ur: {} },
    ...overrides,
  };
}

describe("الحاجزُ على المستودعِ الحقيقيِّ", () => {
  it("١) يمرُّ على المستودعِ كما هوَ", () => {
    expect(findViolations(readRepository())).toEqual([]);
  });

  it("٢) يقرأُ أصنافَ القيدِ من الهجرةِ الحقيقيّةِ مطابقةً للسجلِّ", () => {
    const repository = readRepository();
    expect(repository.migrationSql).not.toBeNull();
    const kinds = kindsFromConstraint(repository.migrationSql ?? "");
    expect(kinds).not.toBeNull();
    expect([...(kinds ?? [])].sort()).toEqual([...DECLARED_CONSENT_KINDS].sort());
  });
});

describe("الحاجزُ يُخفِقُ على الافتراقِ", () => {
  it("٣) هجرةٌ مفقودةٌ تُبلَّغُ صريحةً", () => {
    const violations = findViolations(input({ migrationSql: null }));
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("لا هجرةَ");
  });

  it("٤) هجرةٌ بلا قيدِ `kind in (...)` تُبلَّغُ ولا تُقرأُ مجموعةً فارغةً", () => {
    const violations = findViolations(
      input({ migrationSql: "-- migration-phase: expand\ncreate table if not exists x ();\n" }),
    );
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("بلا قيدِ");
  });

  it("٥) صنفٌ مُعلَنٌ وغائبٌ عن القيدِ يُخفِقُ", () => {
    const kinds = [...DECLARED_CONSENT_KINDS].slice(1);
    const violations = findViolations(input({ migrationSql: migrationWith(kinds) }));
    expect(violations.some((v) => v.includes("وليسَ في قيدِ الهجرةِ"))).toBe(true);
  });

  it("٦) صنفٌ في القيدِ وغيرُ مُعلَنٍ يُخفِقُ", () => {
    const violations = findViolations(
      input({ migrationSql: migrationWith([...DECLARED_CONSENT_KINDS, "cookie_banner"]) }),
    );
    expect(violations.some((v) => v.includes("وليسَ في السجلِّ المُعلَنِ"))).toBe(true);
  });

  it("٧) مفتاحُ عنوانٍ مفقودٌ في لغةٍ واحدةٍ يُخفِقُ باسمِ اللغةِ", () => {
    const dictionaries = fullDictionaries();
    const first = DECLARED_CONSENT_DOCUMENTS[0];
    if (first === undefined) throw new Error("سجلٌّ فارغٌ");
    delete (dictionaries.ur as Record<string, string>)[first.titleKey];
    const violations = findViolations(input({ miniappDictionaries: dictionaries }));
    expect(violations.some((v) => v.includes("«ur»"))).toBe(true);
  });

  it("٨) مفتاحٌ موجودٌ بنصٍّ فارغٍ يُخفِقُ كما يُخفِقُ المفقودُ", () => {
    const dictionaries = fullDictionaries();
    const first = DECLARED_CONSENT_DOCUMENTS[0];
    if (first === undefined) throw new Error("سجلٌّ فارغٌ");
    (dictionaries.en as Record<string, string>)[first.summaryKey] = "   ";
    const violations = findViolations(input({ miniappDictionaries: dictionaries }));
    expect(violations.some((v) => v.includes(first.summaryKey))).toBe(true);
  });

  it("٩) قاموسٌ فيه مفتاحٌ زائدٌ عن العربيّةِ يُخفِقُ في الاتجاهَينِ", () => {
    const extra = fullDictionaries();
    (extra.en as Record<string, string>)["welcome.only_in_english"] = "x";
    expect(
      findViolations(input({ miniappDictionaries: extra })).some((v) =>
        v.includes("وغائبٌ عن «ar»"),
      ),
    ).toBe(true);

    const missing = fullDictionaries();
    (missing.ar as Record<string, string>)["welcome.only_in_arabic"] = "x";
    expect(
      findViolations(input({ miniappDictionaries: missing })).some((v) =>
        v.includes("وغائبٌ عن «en»"),
      ),
    ).toBe(true);
  });

  it("١٠) مفتاحٌ مشتركٌ مع قاموسِ البوتاتِ يُخفِقُ (القاعدة 0.6)", () => {
    const dictionaries = fullDictionaries();
    const first = DECLARED_CONSENT_DOCUMENTS[0];
    if (first === undefined) throw new Error("سجلٌّ فارغٌ");
    const violations = findViolations(
      input({
        miniappDictionaries: dictionaries,
        botDictionaries: { ar: { [first.titleKey]: "نصٌّ آخرُ" }, en: {}, ur: {} },
      }),
    );
    expect(violations.some((v) => v.includes("القاعدة 0.6"))).toBe(true);
  });
});
