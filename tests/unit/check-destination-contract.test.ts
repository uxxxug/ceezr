/**
 * الغرض: إثباتُ أنَّ حاجزَ عقدِ الوجهةِ **يُخفِقُ فعلاً** على كلِّ افتراقٍ يدّعي
 *   منعَه — لا أنَّه يمرُّ على المستودعِ كما هوَ اليومَ (`F2-03`). وحاجزٌ لا
 *   يُخفِقُ في اختبارٍ سالبٍ تغطيةٌ مُدَّعاةٌ لا مقيسةٌ.
 * الحالة: اختبار فعلي — يُستورَدُ الحاجزُ ويُستدعى على مُدخلاتٍ مُصنَّعةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI
 * يُتوقع أن يستخدمه لاحقاً: كلُّ قاعدةٍ تُضافُ إلى الحاجزِ.
 * ملاحظات مستقبلية: يُفحَصُ ههنا **المستودعُ الحقيقيُّ** في آخرِ الملفِّ أيضاً،
 *   فلو اختلفَت الهجرةُ عن النطاقِ سقطَ الاختبارُ لا الحاجزُ وحدَه.
 */

import { describe, expect, it } from "bun:test";
import {
  DESTINATION_REFUSALS,
  LANDMARK_KINDS,
} from "../../packages/domain/destinations/landmark-kinds.ts";
import {
  ALLOWED_CHARACTER_CLASS,
  foldingFrom,
  foldingTo,
} from "../../packages/domain/destinations/search-text.ts";
import {
  characterClassFrom,
  findViolations,
  kindsFromConstraint,
  REQUIRED_DESTINATION_KEYS,
  type RepositoryInput,
  readRepository,
  refusalsFromMigration,
  translateArgumentsFrom,
} from "../../scripts/check-destination-contract.ts";

const LANGUAGES = ["ar", "en", "ur"] as const;

const INDEX_SUFFIXES = [
  "_f2_03_service_area_city_index.sql",
  "_f2_03_landmarks_search_index.sql",
  "_f2_03_landmarks_point_index.sql",
] as const;

const INDEX_NAMES: Readonly<Record<string, string>> = {
  "_f2_03_service_area_city_index.sql": "city_service_areas_active_city_idx",
  "_f2_03_landmarks_search_index.sql": "destination_landmarks_search_idx",
  "_f2_03_landmarks_point_index.sql": "destination_landmarks_point_idx",
};

function allKeys(): readonly string[] {
  return [
    ...REQUIRED_DESTINATION_KEYS,
    ...LANDMARK_KINDS.map((kind) => `rider.destination.kind.${kind}`),
    ...DESTINATION_REFUSALS.map((code) => `rider.destination.refused.${code}`),
  ];
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

/** هجرةٌ مُصنَّعةٌ مُطابِقةٌ تماماً — كلُّ اختبارٍ سالبٍ يُفسِدُ فيها سطراً واحداً. */
function migrationSql(
  over: {
    readonly from?: string;
    readonly to?: string;
    readonly characterClass?: string;
    readonly kinds?: readonly string[];
    readonly refusals?: readonly string[];
  } = {},
): string {
  const from = over.from ?? foldingFrom();
  const to = over.to ?? foldingTo();
  const characterClass = over.characterClass ?? ALLOWED_CHARACTER_CLASS;
  const kinds = over.kinds ?? LANDMARK_KINDS;
  const refusals = over.refusals ?? DESTINATION_REFUSALS;
  const refusalBranches = refusals
    .map((code) => `    return jsonb_build_object('error', '${code}');`)
    .join("\n");
  return [
    "create or replace function normalize_search_text(p_input text)",
    "returns text language sql immutable as $fn$",
    "  select btrim(",
    "           regexp_replace(",
    "             regexp_replace(",
    "               lower(",
    "                 translate(",
    "                   coalesce(p_input, ''),",
    "                   -- تعليقٌ في موضعِ القرارِ — مسموحٌ ولا يُفسِدُ القراءةَ.",
    `                   '${from.replaceAll("'", "''")}',`,
    `                   '${to.replaceAll("'", "''")}'`,
    "                 )",
    "               ),",
    `               '${characterClass}', ' ', 'g'`,
    "             ),",
    "             ' +', ' ', 'g'",
    "           )",
    "         );",
    "$fn$;",
    "",
    "create table if not exists destination_landmarks (",
    "  id bigserial primary key,",
    "  city_id bigint not null,",
    `  kind text not null constraint destination_landmarks_kind_check check (kind in (${kinds
      .map((kind) => `'${kind}'`)
      .join(", ")}))`,
    ");",
    "",
    "create or replace function resolve_destination(p_city bigint, p_lat double precision, p_lng double precision)",
    "returns jsonb language plpgsql as $fn$",
    "begin",
    "    return jsonb_build_object('error', 'USER_NOT_FOUND');",
    refusalBranches,
    "end;",
    "$fn$;",
  ].join("\n");
}

function indexSql(
  over: { readonly drop?: string; readonly rename?: string; readonly noPhase?: string } = {},
): Record<string, string | null> {
  const files: Record<string, string | null> = {};
  for (const suffix of INDEX_SUFFIXES) {
    if (over.drop === suffix) {
      files[suffix] = null;
      continue;
    }
    const name = over.rename === suffix ? "some_other_idx" : (INDEX_NAMES[suffix] as string);
    const phase =
      over.noPhase === suffix ? "-- migration-phase: expand" : "-- migration-phase: index";
    files[suffix] =
      `${phase}\ncreate index concurrently if not exists ${name} on destination_landmarks (city_id);`;
  }
  return files;
}

function healthy(): RepositoryInput {
  return {
    gazetteerSql: migrationSql(),
    indexSql: indexSql(),
    miniappDictionaries: fullDictionaries(),
  };
}

describe("قارئاتُ الحاجزِ", () => {
  it("تقرأُ وسيطَي الطيِّ من نصٍّ فيه تعليقٌ بينَهما", () => {
    const read = translateArgumentsFrom(migrationSql());
    expect(read).not.toBeNull();
    expect(read?.from).toBe(foldingFrom());
    expect(read?.to).toBe(foldingTo());
  });

  it("تُعيدُ `null` حينَ لا `translate` — غيابٌ يُسمّى باسمِه لا فراغٌ يُقرأُ تطابقاً", () => {
    expect(translateArgumentsFrom("select 1;")).toBeNull();
  });

  it("تقرأُ صنفَ المحارفِ بالشكلِ لا بالموضعِ", () => {
    expect(characterClassFrom(migrationSql())).toBe(ALLOWED_CHARACTER_CLASS);
    expect(characterClassFrom("select 1;")).toBeNull();
  });

  it("تقرأُ الأصنافَ من قيدِ `check` مجموعةً", () => {
    const kinds = kindsFromConstraint(migrationSql());
    expect(kinds).not.toBeNull();
    expect(kinds?.size).toBe(LANDMARK_KINDS.length);
  });

  it("تقرأُ رموزَ الرفضِ من شكلِ الحمولةِ لا من قائمةٍ مكتوبةٍ ثانيةً", () => {
    const refusals = refusalsFromMigration(migrationSql());
    for (const code of DESTINATION_REFUSALS) expect(refusals.has(code)).toBe(true);
    // و`USER_NOT_FOUND` تُقرأُ أيضاً — والحاجزُ يستثنيها صريحاً لا صامتاً.
    expect(refusals.has("USER_NOT_FOUND")).toBe(true);
  });
});

describe("الحاجزُ ينجحُ على مُدخَلٍ سليمٍ", () => {
  it("لا انتهاكَ حينَ يتطابقُ كلُّ شيءٍ", () => {
    expect(findViolations(healthy())).toEqual([]);
  });
});

describe("الحاجزُ يُخفِقُ على كلِّ افتراقٍ يدّعي منعَه", () => {
  it("هجرةٌ غائبةٌ", () => {
    const violations = findViolations({ ...healthy(), gazetteerSql: null });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join("\n")).toContain("_f2_03_destination_gazetteer.sql");
  });

  it("محرفٌ زائدٌ في وسيطِ الطيِّ الأوّلِ", () => {
    const violations = findViolations({
      ...healthy(),
      gazetteerSql: migrationSql({ from: `${foldingFrom()}\u06CC` }),
    });
    expect(violations.length).toBeGreaterThan(0);
  });

  it("محرفٌ مختلفٌ في وسيطِ الطيِّ الثاني", () => {
    const to = foldingTo();
    const violations = findViolations({
      ...healthy(),
      gazetteerSql: migrationSql({ to: `x${to.slice(1)}` }),
    });
    expect(violations.length).toBeGreaterThan(0);
  });

  it("طيٌّ في القاعدةِ لا في النطاقِ — التاءُ المربوطةُ تُطوى هناك وحدَها", () => {
    // وهذا عينُ العطبِ الذي يجعلُ نتيجةً تظهرُ محلّيّاً ولا تظهرُ من الفهرسِ.
    const violations = findViolations({
      ...healthy(),
      gazetteerSql: migrationSql({ from: foldingFrom().replace("\u0629", "") }),
    });
    expect(violations.length).toBeGreaterThan(0);
  });

  it("صنفُ محارفَ مختلفٌ", () => {
    const violations = findViolations({
      ...healthy(),
      gazetteerSql: migrationSql({ characterClass: "[^0-9a-z]+" }),
    });
    expect(violations.join("\n")).toContain("صنفُ المحارفِ مختلفٌ");
  });

  it("صنفُ معلَمٍ في النطاقِ وليسَ في قيدِ الهجرةِ", () => {
    const violations = findViolations({
      ...healthy(),
      gazetteerSql: migrationSql({ kinds: LANDMARK_KINDS.slice(1) }),
    });
    expect(violations.join("\n")).toContain(LANDMARK_KINDS[0] as string);
  });

  it("صنفٌ في قيدِ الهجرةِ وليسَ في النطاقِ", () => {
    const violations = findViolations({
      ...healthy(),
      gazetteerSql: migrationSql({ kinds: [...LANDMARK_KINDS, "teleport_pad"] }),
    });
    expect(violations.join("\n")).toContain("teleport_pad");
  });

  it("رفضٌ تُعيدُه القاعدةُ ولا يعرفُه النطاقُ", () => {
    const violations = findViolations({
      ...healthy(),
      gazetteerSql: migrationSql({ refusals: [...DESTINATION_REFUSALS, "SERVICE_HOURS_ENDED"] }),
    });
    expect(violations.join("\n")).toContain("SERVICE_HOURS_ENDED");
  });

  it("رفضٌ في النطاقِ لا تُعيدُه القاعدةُ — فرعٌ ميِّتٌ يُوهِمُ تغطيةً", () => {
    const violations = findViolations({
      ...healthy(),
      gazetteerSql: migrationSql({ refusals: DESTINATION_REFUSALS.slice(1) }),
    });
    expect(violations.join("\n")).toContain(DESTINATION_REFUSALS[0] as string);
  });

  for (const suffix of INDEX_SUFFIXES) {
    it(`فهرسٌ غائبٌ: ${suffix}`, () => {
      const violations = findViolations({ ...healthy(), indexSql: indexSql({ drop: suffix }) });
      expect(violations.join("\n")).toContain(suffix);
    });

    it(`فهرسٌ باسمٍ آخرَ: ${suffix}`, () => {
      const violations = findViolations({ ...healthy(), indexSql: indexSql({ rename: suffix }) });
      expect(violations.join("\n")).toContain(INDEX_NAMES[suffix] as string);
    });

    it(`فهرسٌ في غيرِ طورِ الفهرسةِ: ${suffix}`, () => {
      const violations = findViolations({ ...healthy(), indexSql: indexSql({ noPhase: suffix }) });
      expect(violations.length).toBeGreaterThan(0);
    });
  }

  it("فهرسٌ بلا `concurrently` — بناءٌ يحجبُ الكتابةَ", () => {
    const files = indexSql();
    const suffix = INDEX_SUFFIXES[0];
    files[suffix] =
      `-- migration-phase: index\ncreate unique index if not exists ${INDEX_NAMES[suffix] as string} on city_service_areas (city_id);`;
    const violations = findViolations({ ...healthy(), indexSql: files });
    expect(violations.join("\n")).toContain("concurrently");
  });

  for (const language of LANGUAGES) {
    it(`مفتاحٌ غائبٌ في «${language}.json»`, () => {
      const dictionaries = fullDictionaries();
      delete (dictionaries[language] as Record<string, string>)[
        REQUIRED_DESTINATION_KEYS[0] as string
      ];
      const violations = findViolations({ ...healthy(), miniappDictionaries: dictionaries });
      expect(violations.join("\n")).toContain(language);
    });

    it(`مفتاحٌ فارغٌ في «${language}.json» — الفراغُ ليسَ ترجمةً`, () => {
      const dictionaries = fullDictionaries();
      (dictionaries[language] as Record<string, string>)[REQUIRED_DESTINATION_KEYS[0] as string] =
        "   ";
      const violations = findViolations({ ...healthy(), miniappDictionaries: dictionaries });
      expect(violations.join("\n")).toContain(language);
    });
  }

  it("مفتاحُ صنفٍ غائبٌ — فيظهرُ للمستخدمِ مفتاحاً خامّاً", () => {
    const dictionaries = fullDictionaries();
    delete (dictionaries.ar as Record<string, string>)[
      `rider.destination.kind.${LANDMARK_KINDS[0] as string}`
    ];
    expect(
      findViolations({ ...healthy(), miniappDictionaries: dictionaries }).length,
    ).toBeGreaterThan(0);
  });

  it("مفتاحُ رفضٍ غائبٌ", () => {
    const dictionaries = fullDictionaries();
    delete (dictionaries.ur as Record<string, string>)[
      `rider.destination.refused.${DESTINATION_REFUSALS[0] as string}`
    ];
    expect(
      findViolations({ ...healthy(), miniappDictionaries: dictionaries }).length,
    ).toBeGreaterThan(0);
  });
});

describe("المستودعُ الحقيقيُّ", () => {
  it("لا انتهاكَ في المستودعِ كما هوَ", () => {
    expect(findViolations(readRepository())).toEqual([]);
  });
});
