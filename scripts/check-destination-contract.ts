#!/usr/bin/env bun
/**
 * # حاجزُ عقدِ الوجهةِ — لا تطبيعَ في زمنَينِ يتباعدُ، ولا رفضَ بلا نصٍّ يُقرأُ
 *
 * **الغرض:** يفرضُ البندَ `F2-03` بستِّ قواعدَ تُقرأُ من المستودعِ نفسِه:
 *
 * ١) **جدولُ طيِّ الحروفِ في النطاقِ = وسيطا `translate` في الهجرةِ**، نصّاً
 *    بنصٍّ وترتيباً بترتيبٍ. فلو طُوِيَتِ التاءُ المربوطةُ في الشِّفرةِ ولم تُطوَ
 *    في القاعدةِ، لَبحثَ العميلُ عن «جده» فطابَقَ محلّيّاً ولم يُطابِقْ فهرساً —
 *    ونتيجةٌ تظهرُ ثمَّ تغيبُ أسوأُ من لا نتيجةٍ.
 *
 * ٢) **صنفُ المحارفِ المسموحةِ نفسُه** في الموضعَينِ. وحرفٌ يُحذَفُ ههنا ويصيرُ
 *    فاصلاً هناك يُزيحُ كلَّ مواضعِ الإبرازِ في الشاشةِ.
 *
 * ٣) **أصنافُ المعالمِ في النطاقِ = أصنافُ قيدِ `check`** مجموعةً بمجموعةٍ —
 *    عينُ حكمِ `check-place-kinds.ts` في `F2-02` ولذاتِ السببِ.
 *
 * ٤) **كلُّ صنفٍ له مفتاحُ نصٍّ في اللغاتِ الثلاثِ** بنصٍّ غيرِ فارغٍ (§9.11).
 *
 * ٥) **كلُّ رمزِ رفضٍ في النطاقِ له مفتاحٌ في اللغاتِ الثلاثِ، وكلُّ رمزٍ تُعيدُه
 *    الهجرةُ مُعلَنٌ في النطاقِ.** ورفضٌ تُعيدُه القاعدةُ ولا يعرفُه العميلُ
 *    يُعرَضُ نصّاً عامّاً بدلَ السببِ الحقيقيِّ، ورمزٌ في الشِّفرةِ لا تُعيدُه
 *    القاعدةُ فرعٌ ميِّتٌ يُوهِمُ تغطيةً.
 *
 * ٦) **الفهارسُ الثلاثةُ التي يعتمدُها البحثُ والمصادقةُ موجودةٌ في طورِ `index`
 *    بـ`concurrently`.** فهرسٌ مفقودٌ لا يُخفِقُ اختباراً — يصيرُ مسحاً كاملاً
 *    على جدولٍ ينمو، فيظهرُ العطبُ عندَ المستخدمِ لا في CI.
 *
 * **ينتمي إلى:** سلسلةَ حرّاسِ CI · خطوةً مُسمّاةً في `.github/workflows/ci.yml`.
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يلمسُ قاعدةً**: يقرأُ نصَّ الهجرةِ. وأنَّ `normalize_search_text` تُعطي
 *   **المخرَجَ نفسَه** الذي تُعطيه دالّةُ النطاقِ يُثبَتُ على PostgreSQL حقيقيٍّ في
 *   `tests/integration/destinations.test.ts` — والتطابقُ النصّيُّ ههنا لا يُغني
 *   عنه: جدولانِ متطابقانِ قد يُنفَّذانِ بترتيبٍ مختلفٍ.
 * - **لا يفحصُ صحّةَ إحداثيّاتِ الدليلِ**: مصادرُها مذكورةٌ في الهجرةِ نفسِها،
 *   والتحقّقُ منها عملُ مراجعٍ لا عملُ مُطابِقِ نصوصٍ.
 * - **لا يحكمُ على جودةِ الترجمةِ**: يفرضُ الوجودَ لا الصحّةَ.
 * - **لا يزعمُ أنَّ الشاشةَ مُجرَّبةٌ عندَ مستخدمٍ**: لا نشرَ حيَّ (ADR 0099)، وما
 *   يفرضُه هذا الحاجزُ اتّساقُ عقدٍ لا صلاحُ تجربةٍ.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DESTINATION_REFUSALS,
  LANDMARK_KINDS,
} from "../packages/domain/destinations/landmark-kinds.ts";
import {
  ALLOWED_CHARACTER_CLASS,
  foldingFrom,
  foldingTo,
} from "../packages/domain/destinations/search-text.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const GAZETTEER_SUFFIX = "_f2_03_destination_gazetteer.sql";
const MINIAPP_I18N_DIR = "packages/shared/i18n/miniapp";
const LANGUAGES = ["ar", "en", "ur"] as const;

/** مفاتيحُ شاشةِ الوجهةِ التي يُوجِبُها معيارُ القبولِ في `SR-03` حرفاً. */
export const REQUIRED_DESTINATION_KEYS: readonly string[] = [
  "rider.destination.title",
  "rider.destination.search.prompt",
  "rider.destination.hint",
  "rider.destination.empty",
  "rider.destination.empty.hint",
  "rider.destination.confirm",
  "rider.destination.city",
  "rider.destination.nearest",
  "rider.destination.map.unavailable",
  "rider.destination.location.action",
  "rider.destination.location.label",
  "rider.destination.location.declined",
  "rider.destination.location.unsupported",
  "rider.destination.location.failed",
  "rider.destination.location.settings",
  "rider.destination.refused.city",
  "rider.destination.refused.again",
  "rider.destination.refused.UNKNOWN",
  "rider.destination.source.saved",
  "rider.destination.source.recent",
  "rider.destination.source.landmark",
  "rider.destination.error.malformed",
  "rider.destination.error.query",
  "rider.destination.error.account",
  "rider.destination.error.unavailable",
  "rider.destination.retry",
  "rider.destination.back",
];

/**
 * الفهارسُ التي يعتمدُها العقدُ. كلُّ واحدٍ في ملفِّه: `create index concurrently`
 * لا يعملُ داخلَ معاملةٍ، والمُطبِّقُ يُشغِّلُ طورَ `index` وحدَه بلا معاملةٍ.
 */
const REQUIRED_INDEXES: readonly { readonly suffix: string; readonly name: string }[] = [
  { suffix: "_f2_03_service_area_city_index.sql", name: "city_service_areas_active_city_idx" },
  { suffix: "_f2_03_landmarks_search_index.sql", name: "destination_landmarks_search_idx" },
  { suffix: "_f2_03_landmarks_point_index.sql", name: "destination_landmarks_point_idx" },
];

export interface RepositoryInput {
  readonly gazetteerSql: string | null;
  readonly indexSql: Readonly<Record<string, string | null>>;
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
  const indexSql: Record<string, string | null> = {};
  for (const required of REQUIRED_INDEXES) {
    indexSql[required.suffix] = latestMigration(required.suffix);
  }
  return {
    gazetteerSql: latestMigration(GAZETTEER_SUFFIX),
    indexSql,
    miniappDictionaries,
  };
}

/**
 * وسيطا `translate` كما كُتِبا في الهجرةِ. ويُقرآنِ **من النصِّ لا من تنفيذٍ**،
 * ولذا يُشترَطُ أن يكونا **حرفيَّينِ مكتوبَينِ**: لو بُنيا بِوصلِ نصوصٍ أو بقراءةِ
 * إعدادٍ لَصارَ المُطابِقُ يُقارِنُ شفرةً لا بيانةً. والتعليقاتُ بينَ الوسيطَينِ
 * مسموحةٌ — الشرحُ في موضعِ القرارِ أنفعُ من شرحٍ بعيدٍ عنه.
 */
export function translateArgumentsFrom(sql: string): { from: string; to: string } | null {
  const comments = "(?:\\s*--[^\\n]*\\n)*";
  const literal = "'((?:[^']|'')*)'";
  const pattern = new RegExp(
    `translate\\s*\\(\\s*coalesce\\s*\\(\\s*p_input\\s*,\\s*''\\s*\\)\\s*,${comments}\\s*${literal}\\s*,${comments}\\s*${literal}`,
  );
  const match = sql.match(pattern);
  if (match === null) return null;
  const unquote = (value: string) => value.replaceAll("''", "'");
  return { from: unquote(match[1] ?? ""), to: unquote(match[2] ?? "") };
}

/**
 * صنفُ المحارفِ المسموحةِ. ويُقرأُ **بالشكلِ** — أوّلُ حرفيٍّ يبتدئُ بـ`[^`
 * وينتهي بـ`]+` — لا بموضعِه من وسيطاتِ `regexp_replace`: الوسيطُ الأوّلُ
 * تعبيرٌ متشعّبٌ فيه فواصلُ، ومُطابِقُ موضعٍ عليه يسقطُ بِإعادةِ تنسيقٍ لا
 * تُغيِّرُ معنىً — فيصيرُ الحاجزُ هشّاً بلا فائدةٍ.
 */
export function characterClassFrom(sql: string): string | null {
  const match = sql.match(/'(\[\^[^'\n]*\]\+)'/);
  return match === null ? null : (match[1] ?? null);
}

/** أصنافُ المعالمِ من قيدِ `check` على عمودِ `kind`. */
export function kindsFromConstraint(sql: string): ReadonlySet<string> | null {
  const match = sql.match(/check\s*\(\s*kind\s+in\s*\(([^)]*)\)/i);
  if (match === null) return null;
  return new Set([...(match[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1] as string));
}

/**
 * رموزُ الرفضِ التي تُعيدُها `resolve_destination` فعلاً: كلُّ نصٍّ يظهرُ في
 * حمولةٍ بصيغةِ `'error', 'CODE'`. والقراءةُ من الشكلِ لا من قائمةٍ مكتوبةٍ
 * ثانيةً: قائمةٌ مكتوبةٌ في الحاجزِ مصدرٌ ثالثٌ للحقيقةِ (القاعدة 0.6).
 */
export function refusalsFromMigration(sql: string): ReadonlySet<string> {
  return new Set(
    [...sql.matchAll(/'error'\s*,\s*'([A-Z_]+)'/g)].map((match) => match[1] as string),
  );
}

function describe(value: string): string {
  return [...value]
    .map(
      (character) => `U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`,
    )
    .join(" ");
}

export function findViolations(input: RepositoryInput): readonly string[] {
  const violations: string[] = [];

  if (input.gazetteerSql === null) {
    violations.push(
      `لا هجرةَ تنتهي بـ«${GAZETTEER_SUFFIX}» — دليلُ الوجهاتِ مُعلَنٌ في الشِّفرةِ بلا جدولٍ ولا دالّةٍ تخدمُه.`,
    );
    return violations;
  }

  const sql = input.gazetteerSql;

  const translated = translateArgumentsFrom(sql);
  if (translated === null) {
    violations.push(
      "لم يُقرأْ `translate(p_input, '…', '…')` من الهجرةِ بحرفيَّينِ مفردَي السطرِ — والحاجزُ يُقارِنُ نصّاً لا تنفيذاً، فوسيطٌ مبنيٌّ بِوصلٍ يجعلُ المقارنةَ بلا معنى.",
    );
  } else {
    const expectedFrom = foldingFrom();
    const expectedTo = foldingTo();
    if (translated.from !== expectedFrom) {
      violations.push(
        `وسيطُ الطيِّ الأوّلُ مختلفٌ بينَ القاعدةِ والنطاقِ — القاعدةُ: ${describe(translated.from)} · النطاقُ: ${describe(expectedFrom)}. وبحثٌ يُطابِقُ في أحدِ الزمنَينِ ولا يُطابِقُ في الآخرِ يُظهِرُ نتيجةً ثمَّ يُغيِّبُها.`,
      );
    }
    if (translated.to !== expectedTo) {
      violations.push(
        `وسيطُ الطيِّ الثاني مختلفٌ بينَ القاعدةِ والنطاقِ — القاعدةُ: ${describe(translated.to)} · النطاقُ: ${describe(expectedTo)}.`,
      );
    }
  }

  const characterClass = characterClassFrom(sql);
  if (characterClass === null) {
    violations.push(
      "لم يُقرأْ صنفُ المحارفِ من `regexp_replace` في الهجرةِ — فلا يُعرَفُ ما يُحفَظُ وما يصيرُ فاصلاً.",
    );
  } else if (characterClass !== ALLOWED_CHARACTER_CLASS) {
    violations.push(
      `صنفُ المحارفِ مختلفٌ — القاعدةُ: «${characterClass}» · النطاقُ: «${ALLOWED_CHARACTER_CLASS}». وحرفٌ يصيرُ فاصلاً في أحدِهما وحدَه يُزيحُ كلَّ مواضعِ الإبرازِ في الشاشةِ.`,
    );
  }

  const constrained = kindsFromConstraint(sql);
  if (constrained === null) {
    violations.push(
      "هجرةُ الدليلِ بلا قيدِ `check (kind in (...))` — فأيُّ نصٍّ يُكتَبُ صنفاً، والشاشةُ تعرضُ ما لا تعرفُ.",
    );
  } else {
    for (const kind of LANDMARK_KINDS) {
      if (!constrained.has(kind)) {
        violations.push(
          `الصنفُ «${kind}» مُعلَنٌ في النطاقِ وليسَ في قيدِ الهجرةِ — إدخالُه يُرَدُّ في القاعدةِ فيصيرُ صنفاً لا صفَّ له أبداً.`,
        );
      }
    }
    for (const kind of constrained) {
      if (!(LANDMARK_KINDS as readonly string[]).includes(kind)) {
        violations.push(
          `الصنفُ «${kind}» في قيدِ الهجرةِ وليسَ في النطاقِ — صفوفُه تُعرَضُ بعنوانٍ عامٍّ ولا يعرفُها أحدٌ.`,
        );
      }
    }
  }

  const returnedRefusals = refusalsFromMigration(sql);
  for (const code of returnedRefusals) {
    // `USER_NOT_FOUND` عطبُ حسابٍ لا رفضُ وجهةٍ: يُترجَمُ 404 في المحوِّلِ ولا
    // يُعلَنُ رفضاً في النطاقِ، فيُستثنى صريحاً لا صامتاً.
    if (code === "USER_NOT_FOUND") continue;
    if (!(DESTINATION_REFUSALS as readonly string[]).includes(code)) {
      violations.push(
        `الرفضُ «${code}» تُعيدُه الهجرةُ وليسَ في ` +
          `\`DESTINATION_REFUSALS\` — يُعرَضُ للمستخدمِ نصّاً عامّاً بدلَ سببِه الحقيقيِّ.`,
      );
    }
  }
  for (const code of DESTINATION_REFUSALS) {
    if (!returnedRefusals.has(code)) {
      violations.push(
        `الرفضُ «${code}» مُعلَنٌ في النطاقِ ولا تُعيدُه الهجرةُ — فرعٌ ميِّتٌ في العميلِ يُوهِمُ تغطيةً لحالةٍ لا تحدثُ.`,
      );
    }
  }

  for (const required of REQUIRED_INDEXES) {
    const indexSql = input.indexSql[required.suffix] ?? null;
    if (indexSql === null) {
      violations.push(
        `لا هجرةَ تنتهي بـ«${required.suffix}» — الفهرسُ «${required.name}» يعتمدُه البحثُ أو المصادقةُ، وغيابُه لا يُخفِقُ اختباراً بل يصيرُ مسحاً كاملاً يظهرُ عندَ المستخدمِ.`,
      );
      continue;
    }
    if (!indexSql.includes(required.name)) {
      violations.push(
        `الملفُّ «${required.suffix}» لا يُنشئُ «${required.name}» — الاسمُ هوَ ما يُقرأُ في خطّةِ التنفيذِ، واسمٌ آخرَ يجعلُ المراجعةَ تُصدِّقُ فهرساً لا وجودَ له.`,
      );
    }
    if (!/-- migration-phase:\s*index/.test(indexSql)) {
      violations.push(
        `الملفُّ «${required.suffix}» بلا سطرِ ` +
          `\`-- migration-phase: index\` — فيُشغَّلُ داخلَ معاملةٍ و\`concurrently\` يُخفِقُ.`,
      );
    }
    if (!/create\s+(unique\s+)?index\s+concurrently/i.test(indexSql)) {
      violations.push(
        `الملفُّ «${required.suffix}» لا يستخدمُ \`concurrently\` — بناءُ فهرسٍ يحجبُ الكتابةَ على جدولٍ حيٍّ.`,
      );
    }
  }

  const keys = [
    ...REQUIRED_DESTINATION_KEYS,
    ...LANDMARK_KINDS.map((kind) => `rider.destination.kind.${kind}`),
    ...DESTINATION_REFUSALS.map((code) => `rider.destination.refused.${code}`),
  ];
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
      `حاجزُ عقدِ الوجهةِ: نجحَ — جدولُ طيٍّ من ${foldingFrom().length} محرفاً مطابقٌ للهجرةِ، ${LANDMARK_KINDS.length} صنفاً مطابقاً لقيدِ الهجرةِ، ${DESTINATION_REFUSALS.length} رمزَ رفضٍ مطابقاً لِما تُعيدُه الدالّةُ، ${REQUIRED_INDEXES.length} فهارسَ في طورِ الفهرسةِ، و${REQUIRED_DESTINATION_KEYS.length + LANDMARK_KINDS.length + DESTINATION_REFUSALS.length} مفتاحاً في ثلاثِ لغاتٍ.`,
    );
  } else {
    console.error("حاجزُ عقدِ الوجهةِ: سقطَ.");
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
  }
}
