#!/usr/bin/env bun
/**
 * # حاجزُ وثائقِ الموافقةِ — لا صنفَ بلا قيدٍ، ولا مفتاحَ بلا ثلاثِ لغاتٍ
 *
 * **الغرض:** يفرضُ البندَ `F2-01` بخمسِ قواعدَ تُقرأُ من المستودعِ نفسِه:
 *
 * ١) **قائمةُ الأصنافِ في السجلِّ = قائمةُ الأصنافِ في قيدِ `check` في الهجرةِ**،
 *    مجموعةً بمجموعةٍ لا احتواءً. صنفٌ في الشيفرةِ ليسَ في القيدِ يُرَدُّ وقتَ
 *    الكتابةِ فيصيرُ زرّاً يُخفِقُ دائماً؛ وصنفٌ في القيدِ ليسَ في الشيفرةِ سطحُ
 *    كتابةٍ لا يعرفُه أحدٌ.
 *
 * ٢) **لكلِّ وثيقةٍ إصدارٌ غيرُ فارغٍ**. والموافقةُ على «بلا إصدارٍ» سجلٌّ لا
 *    يُثبِتُ على أيِّ نصٍّ وُوفِقَ، وهوَ عدمُ سجلٍّ في المعنى القانونيِّ.
 *
 * ٣) **مفتاحا العنوانِ والملخَّصِ موجودانِ في اللغاتِ الثلاثِ** بنصٍّ غيرِ فارغٍ
 *    (القسم 9.11). ومفتاحٌ ناقصٌ يظهرُ للمستخدمِ مفتاحاً خامّاً أو فراغاً، وكِلاهما
 *    شاشةُ موافقةٍ لا تُقرأُ.
 *
 * ٤) **القواميسُ الثلاثةُ متطابقةُ المفاتيحِ**. قاموسٌ ناقصٌ يجعلُ الترجمةَ ترتدُّ
 *    إلى العربيّةِ صامتةً، فيقرأُ مستخدمٌ أرديٌّ نصّاً لا يفهمُه ولا أثرَ في CI.
 *
 * ٥) **لا مفتاحَ مشتركاً بينَ قاموسِ التطبيقِ وقاموسِ البوتاتِ** (القاعدة 0.6).
 *    الفصلُ لميزانيةِ الحزمةِ (9.9)، وما يجعلُه فصلاً لا نسخةً ثانيةً هوَ هذا
 *    الشرطُ حرفاً: مفتاحٌ في الملفَّينِ يصيرُ نصَّينِ يفترقانِ بلا حارسٍ.
 *
 * **ينتمي إلى:** سلسلةَ حرّاسِ CI · خطوةً مُسمّاةً في `.github/workflows/ci.yml`.
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يلمسُ قاعدةً**: يقرأُ نصَّ الهجرةِ. وأنَّ الدالّةَ تكتبُ صفّاً واحداً
 *   وتستنبطُ المدينةَ يُثبَتُ في اختبارِ التكاملِ على PostgreSQL حقيقيٍّ لا ههنا.
 * - **لا يحكمُ على جودةِ الترجمةِ**: يفرضُ الوجودَ لا الصحّةَ. ونصٌّ أردويٌّ
 *   رديءٌ يمرُّ ههنا، وذاكَ حدٌّ مُعلَنٌ لا تغطيةٌ مُدَّعاةٌ.
 * - **لا يفرضُ أن يكونَ نصُّ الوثيقةِ نفسِه منشوراً**: صفحةُ النصِّ الكاملِ بندٌ
 *   قانونيٌّ مستقلٌّ، وهذا الحاجزُ يحرسُ السجلَّ لا المحتوى.
 * - **لا يفحصُ سائرَ شاشاتِ التطبيقِ**: ستّةٌ وأربعونَ نصّاً حرفيّاً في
 *   `apps/miniapp` دَينٌ مُعلَنٌ في `ROADMAP.md`، ولا يُدَّعى ههنا أنَّه مقضيٌّ.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DECLARED_CONSENT_DOCUMENTS,
  DECLARED_CONSENT_KINDS,
} from "../packages/domain/consent/consent-documents.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const CONSENT_MIGRATION_SUFFIX = "_f2_01_user_consents.sql";
const MINIAPP_I18N_DIR = "packages/shared/i18n/miniapp";
const BOT_I18N_DIR = "packages/shared/i18n";
const LANGUAGES = ["ar", "en", "ur"] as const;

export interface RepositoryInput {
  /** نصُّ هجرةِ الموافقاتِ — أو `null` إن لم تُوجَدْ. */
  readonly migrationSql: string | null;
  readonly miniappDictionaries: Readonly<Record<string, Record<string, string>>>;
  readonly botDictionaries: Readonly<Record<string, Record<string, string>>>;
}

export function readRepository(): RepositoryInput {
  const file = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(CONSENT_MIGRATION_SUFFIX))
    .sort()
    .at(-1);
  const migrationSql = file === undefined ? null : readFileSync(join(MIGRATIONS_DIR, file), "utf8");

  const miniappDictionaries: Record<string, Record<string, string>> = {};
  const botDictionaries: Record<string, Record<string, string>> = {};
  for (const language of LANGUAGES) {
    miniappDictionaries[language] = JSON.parse(
      readFileSync(join(MINIAPP_I18N_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;
    botDictionaries[language] = JSON.parse(
      readFileSync(join(BOT_I18N_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  }
  return { migrationSql, miniappDictionaries, botDictionaries };
}

/**
 * أصنافُ القيدِ من نصِّ الهجرةِ. ويُقرأُ `kind in (...)` من قيدِ `check` على
 * عمودِ `kind` — ولو لم يُوجَدْ القيدُ أصلاً تُعادُ `null` **ولا تُعادُ مجموعةٌ
 * فارغةٌ**: الفراغُ يُقرأُ «لا صنفَ» فيُبلَّغُ اختلافاً، والغيابُ عطلٌ آخرُ يُسمّى.
 */
export function kindsFromConstraint(sql: string): ReadonlySet<string> | null {
  const match = sql.match(/kind\s+in\s*\(([^)]*)\)/i);
  if (match === null) return null;
  const values = [...(match[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
  return new Set(values);
}

export function findViolations(input: RepositoryInput): readonly string[] {
  const violations: string[] = [];

  if (input.migrationSql === null) {
    violations.push(
      `لا هجرةَ تنتهي بـ«${CONSENT_MIGRATION_SUFFIX}» — سجلُّ الموافقاتِ مُعلَنٌ في الشيفرةِ بلا جدولٍ يستقبلُه.`,
    );
  } else {
    const constrained = kindsFromConstraint(input.migrationSql);
    if (constrained === null) {
      violations.push(
        "هجرةُ الموافقاتِ بلا قيدِ `kind in (...)` — فأيُّ نصٍّ يُكتَبُ صنفاً، والسجلُّ يقبلُ موافقةً على وثيقةٍ لا وجودَ لها.",
      );
    } else {
      for (const kind of DECLARED_CONSENT_KINDS) {
        if (!constrained.has(kind)) {
          violations.push(
            `الصنفُ «${kind}» مُعلَنٌ في السجلِّ وليسَ في قيدِ الهجرةِ — كتابتُه تُرَدُّ في القاعدةِ فيصيرُ زرّاً يُخفِقُ دائماً.`,
          );
        }
      }
      for (const kind of constrained) {
        if (!(DECLARED_CONSENT_KINDS as readonly string[]).includes(kind)) {
          violations.push(
            `الصنفُ «${kind}» مسموحٌ في قيدِ الهجرةِ وليسَ في السجلِّ المُعلَنِ — سطحُ كتابةٍ بلا وثيقةٍ ولا نصٍّ ولا إصدارٍ.`,
          );
        }
      }
    }
  }

  for (const document of DECLARED_CONSENT_DOCUMENTS) {
    if (document.version.trim().length === 0) {
      violations.push(`الوثيقةُ «${document.kind}» بلا إصدارٍ — موافقةٌ لا تُثبِتُ على أيِّ نصٍّ وُوفِقَ.`);
    }
    for (const language of LANGUAGES) {
      const dictionary = input.miniappDictionaries[language] ?? {};
      for (const key of [document.titleKey, document.summaryKey]) {
        if ((dictionary[key] ?? "").trim().length === 0) {
          violations.push(
            `المفتاحُ «${key}» ناقصٌ أو فارغٌ في «${language}» — شاشةُ موافقةٍ تعرضُ مفتاحاً خامّاً أو فراغاً.`,
          );
        }
      }
    }
  }

  const reference = Object.keys(input.miniappDictionaries.ar ?? {}).sort();
  for (const language of LANGUAGES) {
    if (language === "ar") continue;
    const keys = Object.keys(input.miniappDictionaries[language] ?? {}).sort();
    for (const key of reference) {
      if (!keys.includes(key)) {
        violations.push(
          `المفتاحُ «${key}» موجودٌ في «ar» وغائبٌ عن «${language}» — الترجمةُ ترتدُّ صامتةً إلى العربيّةِ.`,
        );
      }
    }
    for (const key of keys) {
      if (!reference.includes(key)) {
        violations.push(
          `المفتاحُ «${key}» موجودٌ في «${language}» وغائبٌ عن «ar» — مفتاحٌ بلا مرجعٍ ولا ارتدادٍ.`,
        );
      }
    }
  }

  for (const language of LANGUAGES) {
    const miniapp = Object.keys(input.miniappDictionaries[language] ?? {});
    const bot = input.botDictionaries[language] ?? {};
    for (const key of miniapp) {
      if (key in bot) {
        violations.push(
          `المفتاحُ «${key}» في قاموسَي التطبيقِ والبوتِ معاً («${language}») — نسخةٌ ثانيةٌ من النصِّ تفترقُ بلا حارسٍ (القاعدة 0.6).`,
        );
      }
    }
  }

  return violations;
}

function main(): void {
  const input = readRepository();
  const violations = findViolations(input);

  if (violations.length > 0) {
    console.error("❌ حاجزُ وثائقِ الموافقةِ أخفقَ:");
    for (const violation of violations) console.error(`   - ${violation}`);
    process.exit(1);
  }

  const keyCount = Object.keys(input.miniappDictionaries.ar ?? {}).length;
  console.log(
    `✅ وثائقُ الموافقةِ متّسقةٌ — ${DECLARED_CONSENT_DOCUMENTS.length} وثيقةً بأصنافٍ مطابقةٍ لقيدِ الهجرةِ، و${keyCount} مفتاحاً في ثلاثِ لغاتٍ بلا اشتراكٍ مع قاموسِ البوتاتِ.`,
  );
}

// لا يُشغَّل `main` عندَ الاستيرادِ من اختبارٍ: `process.exit` كانَ سيقتلُ المُشغِّل.
if (import.meta.main) main();
