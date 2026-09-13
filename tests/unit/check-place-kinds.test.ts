/**
 * الغرض: إثباتُ أنَّ حاجزَ أنواعِ المكانِ **يُخفِقُ فعلاً** على كلِّ افتراقٍ
 *   يدّعي منعَه — لا أنَّه يمرُّ على المستودعِ كما هوَ اليومَ (`F2-02`).
 * الحالة: اختبار فعلي — يُستورَدُ الحاجزُ ويُستدعى على مُدخلاتٍ مُصنَّعةٍ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: كلُّ قاعدةٍ تُضافُ إلى الحاجزِ تحتاجُ اختباراً سالباً ههنا —
 *   قاعدةٌ بلا اختبارٍ سالبٍ تغطيةٌ مُدَّعاةٌ لا مقيسةٌ.
 */

import { describe, expect, it } from "bun:test";
import {
  SAVED_PLACE_KINDS,
  SINGLETON_PLACE_KINDS,
} from "../../packages/domain/places/place-kinds.ts";
import {
  findViolations,
  kindsFromConstraint,
  kindsFromSingletonIndex,
  REQUIRED_HOME_KEYS,
  type RepositoryInput,
  readRepository,
} from "../../scripts/check-place-kinds.ts";

const LANGUAGES = ["ar", "en", "ur"] as const;

function allKeys(): readonly string[] {
  return [...REQUIRED_HOME_KEYS, ...SAVED_PLACE_KINDS.map((k) => `rider.home.place.${k}`)];
}

function fullDictionaries(): Record<string, Record<string, string>> {
  const dictionaries: Record<string, Record<string, string>> = {};
  for (const language of LANGUAGES) {
    const dictionary: Record<string, string> = {};
    for (const key of allKeys()) dictionary[key] = `${key} ${language}`;
    dictionaries[language] = dictionary;
  }
  return dictionaries;
}

function migrationWith(kinds: readonly string[]): string {
  const list = kinds.map((kind) => `'${kind}'`).join(", ");
  return `-- migration-phase: expand\ncreate table if not exists saved_places (\n  kind text not null check (kind in (${list}))\n);\n`;
}

function indexWith(kinds: readonly string[]): string {
  const list = kinds.map((kind) => `'${kind}'`).join(", ");
  return `-- migration-phase: index\ncreate unique index concurrently if not exists saved_places_user_singleton_idx\n  on saved_places (user_id, kind)\n  where kind in (${list});\n`;
}

function input(overrides: Partial<RepositoryInput> = {}): RepositoryInput {
  return {
    migrationSql: migrationWith([...SAVED_PLACE_KINDS]),
    singletonIndexSql: indexWith([...SINGLETON_PLACE_KINDS]),
    miniappDictionaries: fullDictionaries(),
    ...overrides,
  };
}

describe("حاجزُ أنواعِ المكانِ — قراءةُ النصِّ", () => {
  it("١) يقرأُ أنواعَ القيدِ، ويُعيدُ null عندَ غيابِ القيدِ لا مجموعةً فارغةً", () => {
    expect([...(kindsFromConstraint(migrationWith(["home", "work"])) ?? [])]).toEqual([
      "home",
      "work",
    ]);
    expect(kindsFromConstraint("create table saved_places (kind text not null);")).toBeNull();
  });

  it("٢) يقرأُ أنواعَ شرطِ الفهرسِ الفريدِ، وnull عندَ غيابِ الشرطِ", () => {
    expect([...(kindsFromSingletonIndex(indexWith(["home", "work"])) ?? [])]).toEqual([
      "home",
      "work",
    ]);
    expect(
      kindsFromSingletonIndex(
        "create unique index concurrently x on saved_places (user_id, kind);",
      ),
    ).toBeNull();
  });
});

describe("حاجزُ أنواعِ المكانِ — الافتراقُ المزروعُ", () => {
  it("٣) يمرُّ على مُدخلٍ متّسقٍ مُصنَّعٍ", () => {
    expect(findViolations(input())).toEqual([]);
  });

  it("٤) يسقطُ على نوعٍ في النطاقِ ليسَ في قيدِ الهجرةِ", () => {
    const violations = findViolations(input({ migrationSql: migrationWith(["home", "work"]) }));
    expect(violations.some((v) => v.includes("other") && v.includes("قيدِ الهجرةِ"))).toBe(true);
  });

  it("٥) يسقطُ على نوعٍ في القيدِ ليسَ في النطاقِ", () => {
    const violations = findViolations(
      input({ migrationSql: migrationWith([...SAVED_PLACE_KINDS, "gym"]) }),
    );
    expect(violations.some((v) => v.includes("gym"))).toBe(true);
  });

  it("٦) يسقطُ على غيابِ هجرةِ الأماكنِ أو غيابِ قيدِها", () => {
    expect(findViolations(input({ migrationSql: null })).length).toBeGreaterThan(0);
    expect(
      findViolations(input({ migrationSql: "create table saved_places (kind text);" })).some((v) =>
        v.includes("قيدِ `check"),
      ),
    ).toBe(true);
  });

  it("٧) يسقطُ على مُفرَدٍ في النطاقِ ليسَ في شرطِ الفهرسِ — وهوَ «منزلانِ» في القاعدةِ", () => {
    const violations = findViolations(input({ singletonIndexSql: indexWith(["home"]) }));
    expect(violations.some((v) => v.includes("work") && v.includes("شرطِ الفهرسِ"))).toBe(true);
  });

  it("٨) يسقطُ على نوعٍ في شرطِ الفهرسِ ليسَ مُفرَداً في النطاقِ — وهوَ منعُ مكانٍ مشروعٍ", () => {
    const violations = findViolations(
      input({ singletonIndexSql: indexWith([...SINGLETON_PLACE_KINDS, "other"]) }),
    );
    expect(violations.some((v) => v.includes("other") && v.includes("قائمةٍ مفتوحةٍ"))).toBe(true);
  });

  it("٩) يسقطُ على غيابِ هجرةِ الفهرسِ أو غيابِ شرطِها", () => {
    expect(findViolations(input({ singletonIndexSql: null })).length).toBeGreaterThan(0);
    expect(
      findViolations(input({ singletonIndexSql: "create unique index concurrently x on t (a);" }))
        .length,
    ).toBeGreaterThan(0);
  });

  it("١٠) يسقطُ على مفتاحٍ غائبٍ أو فارغٍ في أيِّ لغةٍ من الثلاثِ", () => {
    for (const language of LANGUAGES) {
      const dictionaries = fullDictionaries();
      const dictionary = dictionaries[language] as Record<string, string>;
      delete dictionary["rider.home.destination.prompt"];
      const missing = findViolations(input({ miniappDictionaries: dictionaries }));
      expect(missing.some((v) => v.includes(language) && v.includes("destination.prompt"))).toBe(
        true,
      );

      const blanked = fullDictionaries();
      (blanked[language] as Record<string, string>)["rider.home.place.home"] = "   ";
      expect(
        findViolations(input({ miniappDictionaries: blanked })).some((v) => v.includes(language)),
      ).toBe(true);
    }
  });
});

describe("حاجزُ أنواعِ المكانِ — المستودَعُ كما هوَ", () => {
  it("١١) لا انتهاكَ في المستودَعِ الحقيقيِّ اليومَ", () => {
    expect(findViolations(readRepository())).toEqual([]);
  });
});
