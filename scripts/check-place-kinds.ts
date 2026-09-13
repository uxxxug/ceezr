#!/usr/bin/env bun
/**
 * # حاجزُ أنواعِ المكانِ المحفوظِ — لا نوعَ في الشِّفرةِ بلا قيدٍ، ولا فريدَ بلا نوعٍ
 *
 * **الغرض:** يفرضُ البندَ `F2-02` بأربعِ قواعدَ تُقرأُ من المستودعِ نفسِه:
 *
 * ١) **قائمةُ الأنواعِ في النطاقِ = قائمةُ الأنواعِ في قيدِ `check` في الهجرةِ**،
 *    مجموعةً بمجموعةٍ لا احتواءً. نوعٌ في الشِّفرةِ ليسَ في القيدِ يُرَدُّ وقتَ
 *    الكتابةِ فيصيرُ زرّاً يُخفِقُ دائماً؛ ونوعٌ في القيدِ ليسَ في الشِّفرةِ سطحُ
 *    كتابةٍ لا يعرفُه أحدٌ. وهوَ عينُ حكمِ `check-consent-documents.ts` في `F2-01`.
 *
 * ٢) **الأنواعُ المُفرَدةُ في النطاقِ = الأنواعُ في شرطِ الفهرسِ الفريدِ الجزئيِّ**.
 *    فلو أُعلِنَ `work` مُفرَداً في الشِّفرةِ وليسَ في شرطِ الفهرسِ، لَعَرَضَتِ
 *    الشاشةُ بطاقةً واحدةً للعملِ والقاعدةُ تسمحُ بعشرٍ — فيرى المستخدمُ آخرَ ما
 *    كتبَ ويبقى ما قبلَه في الجدولِ بلا طريقٍ إليه. والعكسُ يمنعُ مكاناً مشروعاً.
 *
 * ٣) **كلُّ نوعٍ له مفتاحُ نصٍّ في اللغاتِ الثلاثِ** بنصٍّ غيرِ فارغٍ (القسم 9.11):
 *    `rider.home.place.<kind>`. ومفتاحٌ ناقصٌ يظهرُ للمستخدمِ مفتاحاً خامّاً.
 *
 * ٤) **مفاتيحُ شاشةِ الراكبِ موجودةٌ في اللغاتِ الثلاثِ**: عنوانُ «إلى أين؟»
 *    وعناوينُ الأماكنِ وآخرِ الوجهاتِ وشريحتَي الخدمةِ. وقاموسٌ ناقصٌ يجعلُ
 *    الترجمةَ ترتدُّ صامتةً فيقرأُ مستخدمٌ أرديٌّ نصّاً لا يفهمُه بلا أثرٍ في CI.
 *
 * **ينتمي إلى:** سلسلةَ حرّاسِ CI · خطوةً مُسمّاةً في `.github/workflows/ci.yml`.
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يلمسُ قاعدةً**: يقرأُ نصَّ الهجرةِ. وأنَّ `upsert_saved_place` تكتبُ صفّاً
 *   واحداً للمنزلِ وتستنبطُ المدينةَ يُثبَتُ في اختبارِ التكاملِ على PostgreSQL
 *   حقيقيٍّ لا ههنا.
 * - **لا يحكمُ على جودةِ الترجمةِ**: يفرضُ الوجودَ لا الصحّةَ.
 * - **لا يفحصُ نصوصَ سائرِ الشاشاتِ**: النصوصُ الحرفيّةُ الباقيةُ في
 *   `apps/miniapp` دَينٌ مُعلَنٌ في `ROADMAP.md`، ولا يُدَّعى ههنا أنَّه مقضيٌّ.
 * - **لا يفحصُ الوجهاتِ الأخيرةَ**: لا نوعَ لها ولا قيدَ — هيَ قراءةٌ من `orders`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SAVED_PLACE_KINDS, SINGLETON_PLACE_KINDS } from "../packages/domain/places/place-kinds.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const PLACES_MIGRATION_SUFFIX = "_f2_02_saved_places.sql";
const SINGLETON_MIGRATION_SUFFIX = "_f2_02_saved_places_singleton_index.sql";
const MINIAPP_I18N_DIR = "packages/shared/i18n/miniapp";
const LANGUAGES = ["ar", "en", "ur"] as const;

/** مفاتيحُ شاشةِ الراكبِ التي يُوجِبُها معيارُ القبولِ في §9.5 حرفاً. */
export const REQUIRED_HOME_KEYS: readonly string[] = [
  "rider.home.destination.prompt",
  "rider.home.places.title",
  "rider.home.places.empty",
  "rider.home.recent.title",
  "rider.home.recent.empty",
  "rider.home.service.transport",
  "rider.home.service.delivery",
  "rider.home.city.status",
  "rider.home.map.unavailable",
];

export interface RepositoryInput {
  readonly migrationSql: string | null;
  readonly singletonIndexSql: string | null;
  readonly miniappDictionaries: Readonly<Record<string, Record<string, string>>>;
}

function latestMigration(suffix: string): string | null {
  const file = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(suffix))
    .sort()
    .at(-1);
  return file === undefined ? null : readFileSync(join(MIGRATIONS_DIR, file), "utf8");
}

export function readRepository(): RepositoryInput {
  const miniappDictionaries: Record<string, Record<string, string>> = {};
  for (const language of LANGUAGES) {
    miniappDictionaries[language] = JSON.parse(
      readFileSync(join(MINIAPP_I18N_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  }
  return {
    migrationSql: latestMigration(PLACES_MIGRATION_SUFFIX),
    singletonIndexSql: latestMigration(SINGLETON_MIGRATION_SUFFIX),
    miniappDictionaries,
  };
}

/**
 * الأنواعُ من قيدِ `check` على عمودِ `kind`. ولو لم يُوجَدِ القيدُ تُعادُ `null`
 * **ولا تُعادُ مجموعةٌ فارغةٌ**: الفراغُ يُقرأُ «لا نوعَ» فيُبلَّغُ اختلافاً،
 * والغيابُ عطلٌ آخرُ يُسمّى باسمِه.
 */
export function kindsFromConstraint(sql: string): ReadonlySet<string> | null {
  const match = sql.match(/check\s*\(\s*kind\s+in\s*\(([^)]*)\)/i);
  if (match === null) return null;
  return new Set([...(match[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1] as string));
}

/** الأنواعُ من شرطِ `where` في الفهرسِ الفريدِ الجزئيِّ. */
export function kindsFromSingletonIndex(sql: string): ReadonlySet<string> | null {
  const match = sql.match(/where\s+kind\s+in\s*\(([^)]*)\)/i);
  if (match === null) return null;
  return new Set([...(match[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1] as string));
}

function compareSets(
  declared: readonly string[],
  actual: ReadonlySet<string>,
  declaredWhere: string,
  actualWhere: string,
  onDeclaredOnly: (kind: string) => string,
  onActualOnly: (kind: string) => string,
): readonly string[] {
  const violations: string[] = [];
  for (const kind of declared) {
    if (!actual.has(kind)) violations.push(onDeclaredOnly(kind));
  }
  for (const kind of actual) {
    if (!declared.includes(kind)) violations.push(onActualOnly(kind));
  }
  if (violations.length > 0) {
    violations.push(`(المُقارَنةُ: «${declaredWhere}» مقابلَ «${actualWhere}».)`);
  }
  return violations;
}

export function findViolations(input: RepositoryInput): readonly string[] {
  const violations: string[] = [];

  if (input.migrationSql === null) {
    violations.push(
      `لا هجرةَ تنتهي بـ«${PLACES_MIGRATION_SUFFIX}» — الأماكنُ المحفوظةُ مُعلَنةٌ في الشِّفرةِ بلا جدولٍ يستقبلُها.`,
    );
  } else {
    const constrained = kindsFromConstraint(input.migrationSql);
    if (constrained === null) {
      violations.push(
        "هجرةُ الأماكنِ بلا قيدِ `check (kind in (...))` — فأيُّ نصٍّ يُكتَبُ نوعاً، والشاشةُ تعرضُ ما لا تعرفُ.",
      );
    } else {
      violations.push(
        ...compareSets(
          SAVED_PLACE_KINDS,
          constrained,
          "packages/domain/places/place-kinds.ts",
          PLACES_MIGRATION_SUFFIX,
          (kind) =>
            `النوعُ «${kind}» مُعلَنٌ في النطاقِ وليسَ في قيدِ الهجرةِ — كتابتُه تُرَدُّ في القاعدةِ فيصيرُ زرّاً يُخفِقُ دائماً.`,
          (kind) =>
            `النوعُ «${kind}» في قيدِ الهجرةِ وليسَ في النطاقِ — سطحُ كتابةٍ لا يعرفُه أحدٌ ولا تقرأُه شاشةٌ.`,
        ),
      );
    }
  }

  if (input.singletonIndexSql === null) {
    violations.push(
      `لا هجرةَ تنتهي بـ«${SINGLETON_MIGRATION_SUFFIX}» — «منزلٌ واحدٌ» حكمٌ في الشِّفرةِ بلا فهرسٍ يفرضُه، وسِباقُ نقرتَينِ يُنتِجُ منزلَينِ.`,
    );
  } else {
    const indexed = kindsFromSingletonIndex(input.singletonIndexSql);
    if (indexed === null) {
      violations.push(
        "هجرةُ الفهرسِ الفريدِ بلا شرطِ `where kind in (...)` — ففريدٌ كاملٌ يمنعُ المكانَ الثانيَ من نوعِ `other` وهوَ مشروعٌ، أو لا فريدَ أصلاً.",
      );
    } else {
      violations.push(
        ...compareSets(
          SINGLETON_PLACE_KINDS,
          indexed,
          "SINGLETON_PLACE_KINDS",
          SINGLETON_MIGRATION_SUFFIX,
          (kind) =>
            `النوعُ «${kind}» مُفرَدٌ في النطاقِ وليسَ في شرطِ الفهرسِ — الشاشةُ تعرضُ بطاقةً واحدةً والقاعدةُ تقبلُ صفوفاً، فيبقى ما كُتِبَ أوّلاً بلا طريقٍ إليه.`,
          (kind) =>
            `النوعُ «${kind}» في شرطِ الفهرسِ وليسَ مُفرَداً في النطاقِ — القاعدةُ تمنعُ مكاناً ثانياً والشِّفرةُ تَعِدُ بقائمةٍ مفتوحةٍ.`,
        ),
      );
    }
  }

  const keys = [...REQUIRED_HOME_KEYS, ...SAVED_PLACE_KINDS.map((k) => `rider.home.place.${k}`)];
  for (const language of LANGUAGES) {
    const dictionary = input.miniappDictionaries[language] ?? {};
    for (const key of keys) {
      const text = dictionary[key];
      if (typeof text !== "string" || text.trim().length === 0) {
        violations.push(
          `المفتاحُ «${key}» غائبٌ أو فارغٌ في «${language}.json» — يظهرُ للمستخدمِ مفتاحاً خامّاً أو فراغاً، وكِلاهما شاشةٌ لا تُقرأُ.`,
        );
      }
    }
  }

  return violations;
}

if (import.meta.main) {
  const violations = findViolations(readRepository());
  if (violations.length === 0) {
    console.log(
      `حاجزُ أنواعِ المكانِ: نجحَ — ${SAVED_PLACE_KINDS.length} نوعاً مطابقاً لقيدِ الهجرةِ، ${SINGLETON_PLACE_KINDS.length} مُفرَداً مطابقاً لشرطِ الفهرسِ، و${REQUIRED_HOME_KEYS.length + SAVED_PLACE_KINDS.length} مفتاحاً في ثلاثِ لغاتٍ.`,
    );
  } else {
    console.error("حاجزُ أنواعِ المكانِ: سقطَ.");
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
  }
}
