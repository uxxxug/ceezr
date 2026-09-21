#!/usr/bin/env bun
/**
 * # حاجزُ عقدِ الاقتباسِ — لا أجرةً قبلَ قرارٍ نظاميٍّ، ولا مسافةً بلا وسمٍ
 *
 * **الغرض:** يفرضُ البندَ `F2-04` بسبعِ قواعدَ تُقرأُ من المستودعِ نفسِه، وكلُّ
 * واحدةٍ منها حكمٌ سياديٌّ أو معماريٌّ كانَ يُحرَسُ بالمراجعةِ البشريّةِ وحدَها:
 *
 * ١) **لا مفردةَ أجرةٍ ولا سعرٍ ولا دفعٍ في شريحةِ الراكبِ.** `ADR 0039` §٤
 *    يحجبُ آليّةَ الأجرةِ على `DEC-11`، و§٦ لا يقبلُ سنداً إلّا قراراً نظاميّاً
 *    مكتوباً — «أيُّ تحليلٍ داخليٍّ، بشريٍّ أو آليٍّ، لا يُقبَلُ سنداً». و`م13-7`
 *    يُجمِّدُ **الهياكلَ التمهيديّةَ** نصّاً: لا أعمدةَ ولا ترحيلاتٍ ولا واجهاتٍ
 *    ولا حقولَ عرضٍ «جاهزةً للأجرةِ». وحكمٌ بهذا الوزنِ لا يُحرَسُ بالنيّةِ:
 *    مُهندسٌ لاحقٌ يُضيفُ `fare: null` «تمهيداً» فيُخالِفُ قراراً سياديّاً وهوَ
 *    يظنُّ أنَّه يُحسِنُ. فالحاجزُ يُسقِطُ CI على المفردةِ نفسِها.
 *    والسماحُ الوحيدُ **مُعلَنٌ**: `subscription_price_*` — سعرُ اشتراكِ السائقِ
 *    وهوَ مصدرُ الإيرادِ المُقرَّرُ (`ADR 0027`)، والراكبُ لا يدفعُه.
 *
 * ٢) **المسافةُ لا تُنشَرُ إلّا موسومةً.** قاسَ `ADR 0024` نسبةَ الالتفافِ على
 *    خمسةَ عشرَ زوجاً حقيقيّاً فبلغَت **2.834** في أسوأِها؛ فخطٌّ مستقيمٌ يُعرَضُ
 *    بلا وسمٍ يُقرأُ «طولُ طريقي» وهوَ أقلُّ من الحقيقةِ بنحوِ 65٪. فيُشترَطُ أن
 *    تحملَ الحمولةُ في القاعدةِ والعقدُ في الشِّفرةِ الوسمَ معَ الرقمِ دائماً.
 *
 * ٣) **رفضا منطقةِ الخدمةِ رمزانِ مفصولانِ.** فعلُ التصحيحِ مختلفٌ: «تحرَّكْ»
 *    و«اخترْ وجهةً أخرى». ورمزٌ واحدٌ يُنتِجُ شاشةً تنصحُ الراكبَ بتصحيحِ ما لم
 *    يُخطئْ فيه.
 *
 * ٤) **المدّةُ من `packages/domain/eta` وحدَها.** لا حسبةَ زمنٍ في الشريحةِ:
 *    `ADR 0024` يمنعُ السرعةَ الثابتةَ ومعاملَ الالتفافِ بقياسٍ.
 *
 * ٥) **الشاشةُ تُعيدُ مفاتيحَ لا نصّاً** (§9.11): لا حرفَ عربيَّ في نصوصِ
 *    الشريحةِ العميلةِ، وكلُّ مفتاحٍ يُوجِبُه المعيارُ موجودٌ في اللغاتِ الثلاثِ.
 *
 * ٦) **دالّتا القاعدةِ منزوعتا التنفيذِ عن `public` و`anon` و`authenticated`.**
 *    دالّةٌ تقرأُ مدينةَ صاحبِ معرّفٍ مفتوحةً للمفتاحِ العامِّ بابُ تعدادٍ.
 *
 * ٧) **لا سرعةَ ثابتةً ولا معاملَ التفافٍ في الشريحةِ** — مفرداتٍ وأرقاماً.
 *
 * ٨) **بيانُ طريقةِ الدفعِ موجودٌ ومرسومٌ وقبلَ زرِّ الطلبِ** (الخطوةُ ٩). وهذه
 *    القاعدةُ **مقلوبةُ الأولى**: الأولى تمنعُ آليّةَ أجرةٍ، وهذه تُوجِبُ نفيَها
 *    نصّاً. ولولاها لَكانَ الحاجزُ يفرضُ الصمتَ قبلَ فعلٍ لا رجعةَ فيه، والصمتُ
 *    يُقرأُ «التطبيقُ يتولّى الدفعَ». والسماحُ لمفاتيحِها **بنصِّها الكاملِ**
 *    ومشروطٌ: سطرٌ استُثنيَ بها يُفحَصُ بعدَ نزعِها.
 *
 * **ينتمي إلى:** سلسلةَ حرّاسِ CI · خطوةً مُسمّاةً في `.github/workflows/ci.yml`.
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يلمسُ قاعدةً**: يقرأُ نصَّ الهجرةِ. وأنَّ `quote_ride` تحكمُ فعلاً كما
 *   يُوصَفُ يُثبَتُ على PostgreSQL حقيقيٍّ في `tests/integration/quote.test.ts`.
 * - **لا يفحصُ صحّةَ الترجمةِ**: يفرضُ الوجودَ لا الجودةَ.
 * - **لا يمنعُ الأجرةَ في كلِّ المستودعِ**: نطاقُه شريحةُ الاقتباسِ وهجرتُها؛
 *   والاشتراكُ والمحفظةُ في سلسلةِ `F3` لها مفرداتُها المشروعةُ.
 * - **لا يزعمُ أنَّ الشاشةَ جُرِّبَت عندَ مستخدمٍ**: لا نشرَ حيَّ (`ADR 0099`).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVICE_KINDS } from "../packages/domain/quote/service-offer.ts";
import { blankComments, blankSqlComments } from "./lib/blank-comments.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const QUOTE_MIGRATION_SUFFIX = "_f2_04_ride_quote_judgement.sql";
const MINIAPP_I18N_DIR = "packages/shared/i18n/miniapp";
const BOT_I18N_DIR = "packages/shared/i18n";
const RIDER_DIALOG_FILE = "packages/application/bots/rider-dialog.ts";
const LANGUAGES = ["ar", "en", "ur"] as const;

/** مِلفّاتُ الشريحةِ — كلُّ ما يُقرأُ ويُفحَصُ، مكتوبةً لا مُكتشَفةً بنمطٍ. */
export const SLICE_FILES: readonly string[] = [
  "packages/domain/quote/distance-kind.ts",
  "packages/domain/quote/service-offer.ts",
  "packages/application/quote/ports.ts",
  "packages/application/quote/quote-ride.ts",
  "packages/infrastructure/quote/quote-store.ts",
  "apps/gateway/src/routes/quote.ts",
  "apps/miniapp/src/surfaces/rider/quote/quote-contract.ts",
  "apps/miniapp/src/surfaces/rider/quote/quote-api.ts",
  "apps/miniapp/src/surfaces/rider/quote/quote-view.ts",
  "apps/miniapp/src/surfaces/rider/quote/QuoteScreen.tsx",
];

/** مِلفّا العميلِ اللذانِ يُمنَعُ فيهما النصُّ المعروضُ (§9.11). */
export const CLIENT_TEXT_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/rider/quote/quote-view.ts",
  "apps/miniapp/src/surfaces/rider/quote/QuoteScreen.tsx",
];

/**
 * مفرداتُ الأجرةِ الممنوعةُ. كلمةٌ كاملةٌ بحدودٍ، لا جزءُ كلمةٍ: `priceless`
 * ليسَ سعراً، و`payload` ليسَ دفعاً — ومُطابِقٌ فضفاضٌ يُسقِطُ CI على نصٍّ بريءٍ
 * فيُدرَّبُ الفريقُ على تعطيلِ الحاجزِ، وذاكَ أسوأُ من غيابِه.
 */
export const FORBIDDEN_FARE_WORDS: readonly string[] = [
  "fare",
  "price",
  "pricing",
  "payment",
  "payments",
  "pay",
  "cash",
  "tariff",
  "surge",
  "invoice",
  "wallet",
  "charge",
  "cost",
  "أجرة",
  "الأجرة",
  "سعر",
  "السعر",
  "الدفع",
  "الدفعُ",
  "نقداً",
];

/**
 * السماحُ المُعلَنُ. يُفحَصُ **قبلَ** المنعِ، ويُعلَنُ ههنا لا يُخفى في تعليقٍ:
 * الفرقُ بينَ حاجزٍ يُحتَرَمُ وحاجزٍ يُلفُّ عليه هوَ أن يكونَ استثناؤه مكتوباً.
 */
/**
 * مفاتيحُ بيانِ طريقةِ الدفعِ — الخطوةُ ٩. **أربعةُ مفاتيحَ بنصِّها الكاملِ**، لا
 * سابقةٌ ولا نمطٌ: سماحٌ بسابقةِ `rider.quote.payment.` يُمرِّرُ
 * `rider.quote.payment.amount` غداً، وذاكَ عينُ ما تمنعُه القاعدةُ الأولى.
 */
export const PAYMENT_DISCLOSURE_KEYS: readonly string[] = [
  "rider.quote.payment.title",
  "rider.quote.payment.direct",
  "rider.quote.payment.noCustody",
  "rider.quote.payment.noAmount",
];

/**
 * وأسماءُ أصنافِ العرضِ للبيانِ نفسِه. **والأطولُ أوّلاً** كي يُنزَعَ
 * `qt__payment-line` قبلَ `qt__payment` في فحصِ السطرِ المسموحِ.
 *
 * ولِمَ تُعلَنُ أصلاً؟ لأنَّ مُطابِقَ القاعدةِ الأولى **لا يَعُدُّ الشُّرطةَ
 * السفليّةَ حدّاً** بسببٍ مقيسٍ (`price_amount` كانَ يُفلِتُ)، فـ`qt__payment`
 * يُقرأُ مفردةً. **وهذا صوابُ المُطابِقِ لا خطؤه**، فلا يُضعَّفُ لأجلِ صنفٍ؛
 * يُعلَنُ الصنفُ ويُحرَسُ سطرُه.
 */
export const PAYMENT_DISCLOSURE_LITERALS: readonly string[] = [
  ...PAYMENT_DISCLOSURE_KEYS,
  "qt__payment-line",
  "qt__payment",
];

/** مفتاحُ بيانِ الدفعِ في البوتِ — مُعلَنٌ بنصِّه الكاملِ لا بسابقةٍ (`ADR 0170`). */
export const BOT_PAYMENT_NOTICE_LITERAL = '"rider.payment_notice"';

export const DECLARED_FARE_ALLOWANCES: readonly string[] = [
  // سعرُ اشتراكِ السائقِ — مصدرُ الإيرادِ المُقرَّرُ (`ADR 0027`).
  "subscription_price_",
  /*
   * بيانُ طريقةِ الدفعِ. **وهوَ ضدُّ آليّةِ الأجرةِ لا تمهيدٌ لها**: نصٌّ يقولُ
   * إنَّ وَصْلة لا تقبضُ ولا تحفظُ ولا تُحدِّدُ مبلغاً. ولو مُنِعَ لَكانَ
   * الحاجزُ يفرضُ **الصمتَ** قبلَ فعلٍ لا رجعةَ فيه، والصمتُ في تطبيقٍ يُقرأُ
   * «التطبيقُ يتولّى الدفعَ» — فيصيرُ الحاجزُ سبباً في الإيهامِ الذي كُتِبَ
   * لمنعِه.
   *
   * **والسماحُ مقلوبٌ لا مُمرِّرٌ**: القاعدةُ ٨ تُسقِطُ البناءَ إن **غابَ** هذا
   * البيانُ أو لم يُرسَمْ أو رُسِمَ بعدَ زرِّ الطلبِ. فهوَ واجبٌ لا رخصةٌ،
   * ولا يصيرُ سماحاً ميّتاً يُتَّكَأُ عليه.
   */
  ...PAYMENT_DISCLOSURE_LITERALS,
  /*
   * ومفتاحُ بيانِ الدفعِ في **البوتِ** كذلكَ (`ADR 0170`). والعطبُ تكرَّرَ حرفاً:
   * `check-ride-request-contract` يستوردُ هذه القائمةَ ويمنعُ `payment` في حوارِ
   * الراكبِ، فسقطَ على السطرِ ١٤٩٤ — **فحاجزانِ لا حاجزٌ كانا يفرضانِ الصمتَ**.
   * وعِوَضُ السماحِ **القاعدةُ ٩**: تُسقِطُ البناءَ إن غابَ المفتاحُ أو غابَ
   * مَعبَرُه أو طُلِبَ مُدخَلٌ أخيرٌ من غيرِه، **وتُعيدُ فحصَ سطرِه بعدَ نزعِه**
   * فلا يستترُ حقلُ أجرةٍ في ظلِّ سماحٍ.
   */
  BOT_PAYMENT_NOTICE_LITERAL,
  // اسمُ القرارِ المحجوبِ ونصُّ المنعِ: ذِكرُ الممنوعِ لِبيانِ منعِه مشروعٌ.
  "0039",
  "DEC-11",
  "F12-16",
];

/** مفرداتُ الاختراعِ الزمنيِّ الممنوعةُ (`ADR 0024`). */
export const FORBIDDEN_SPEED_WORDS: readonly string[] = [
  "detour",
  "detourfactor",
  "averagespeed",
  "constantspeed",
  "speedkmh",
  "kmph",
  "معامل الالتفاف",
];

/** مفاتيحُ شاشةِ الاقتباسِ التي يُوجِبُها معيارُ القبولِ في `SR-04` حرفاً. */
export const REQUIRED_QUOTE_KEYS: readonly string[] = [
  "rider.quote.title",
  "rider.quote.destination",
  "rider.quote.city",
  "rider.quote.locating",
  "rider.quote.asking",
  "rider.quote.measures",
  "rider.quote.distanceMeters",
  "rider.quote.distanceKilometers",
  "rider.quote.distance.straightLine",
  "rider.quote.distance.unavailable",
  "rider.quote.durationMinutes",
  "rider.quote.duration.notConfigured",
  "rider.quote.duration.providerDown",
  "rider.quote.duration.noRoute",
  "rider.quote.duration.offRoad",
  "rider.quote.duration.snapUnknown",
  "rider.quote.duration.implausible",
  "rider.quote.duration.noInput",
  "rider.quote.duration.unknown",
  "rider.quote.services",
  "rider.quote.service.noCapableDriver",
  "rider.quote.service.unavailable",
  "rider.quote.refused.invalidPoint",
  "rider.quote.refused.noServiceArea",
  "rider.quote.refused.originOutside",
  "rider.quote.refused.destinationOutside",
  "rider.quote.refused.unknown",
  "rider.quote.remedy.relocate",
  "rider.quote.remedy.pickAnother",
  "rider.quote.retry",
  "rider.quote.back",
  "rider.quote.error.session",
  "rider.quote.error.malformed",
  "rider.quote.error.account",
  "rider.quote.error.unavailable",
  "rider.quote.next.notBuilt",
];

/** دالّتا القاعدةِ اللتانِ يجبُ نزعُ تنفيذِهما عن الأدوارِ العامّةِ. */
export const REVOKED_FUNCTIONS: readonly string[] = [
  "city_served_services(uuid)",
  "quote_ride(bigint, double precision, double precision, double precision, double precision)",
];

export const REVOKED_ROLES: readonly string[] = ["public", "anon", "authenticated"];

/**
 * رموزٌ تُعيدُها الهجرةُ في حقلِ `error` وهيَ **ليست رفضَ اقتباسٍ** بل عطبُ
 * حسابٍ يُترجَمُ خطأَ متجرٍ (`USER_NOT_FOUND` ⇒ 404). ومُعلَنةٌ ههنا بالاسمِ كي
 * لا يُوسَّعَ الاستثناءُ صامتاً: كلُّ رمزٍ جديدٍ يُحسَبُ رفضاً حتّى يُكتَبَ ههنا
 * بقرارٍ مقروءٍ في المراجعةِ.
 */
export const NON_REFUSAL_ERROR_CODES: readonly string[] = ["USER_NOT_FOUND"];

export interface RepositoryInput {
  readonly migrationSql: string | null;
  readonly sliceSources: Readonly<Record<string, string | null>>;
  readonly miniappDictionaries: Readonly<Record<string, Record<string, string>>>;
  /** القاعدةُ ٩ — بابُ البوتِ يُنشئُ الطلبَ كذلكَ، فيُقرأُ معَ المِنِي آب لا بعدَه. */
  readonly riderDialogSource: string | null;
  readonly botDictionaries: Readonly<Record<string, Record<string, string>>>;
}

function latestMigration(suffix: string): string | null {
  const file = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(suffix))
    .sort()
    .at(-1);
  return file === undefined ? null : readFileSync(join(MIGRATIONS_DIR, file), "utf8");
}

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function readRepository(): RepositoryInput {
  const miniappDictionaries: Record<string, Record<string, string>> = {};
  for (const language of LANGUAGES) {
    miniappDictionaries[language] = JSON.parse(
      readFileSync(join(MINIAPP_I18N_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  }
  const sliceSources: Record<string, string | null> = {};
  for (const path of SLICE_FILES) sliceSources[path] = readIfPresent(path);
  const botDictionaries: Record<string, Record<string, string>> = {};
  for (const language of LANGUAGES) {
    botDictionaries[language] = JSON.parse(
      readFileSync(join(BOT_I18N_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  }
  return {
    migrationSql: latestMigration(QUOTE_MIGRATION_SUFFIX),
    sliceSources,
    miniappDictionaries,
    riderDialogSource: readIfPresent(RIDER_DIALOG_FILE),
    botDictionaries,
  };
}

/**
 * سطرٌ يُفحَصُ أو يُطرَحُ. يُطرَحُ السطرُ الذي يحملُ سماحاً مُعلَناً — وسماحُ
 * **السطرِ** لا سماحُ المِلفِّ: استثناءٌ يفتحُ مِلفّاً كلَّه يُبطِلُ الحاجزَ.
 */
export function isAllowedLine(line: string): boolean {
  return DECLARED_FARE_ALLOWANCES.some((allowance) => line.includes(allowance));
}

/**
 * حدُّ الكلمةِ: حرفٌ أو رقمٌ. **والشُّرطةُ السفليّةُ ليست حدّاً** عن قصدٍ وبسببٍ
 * مقيسٍ: كُتِبَت هذه الدالّةُ أوّلَ مرّةٍ والشُّرطةُ فيها حدٌّ، فأخفقَت الحالةُ
 * السالبةُ `alter table rides add column price_amount` — أي أنَّ **عموداً**
 * باسمٍ مُركَّبٍ كانَ يُفلِتُ من حاجزٍ غرضُه الأوّلُ منعُ الأعمدةِ. والأسماءُ في
 * SQL وفي TypeScript تُركَّبُ بالشُّرطةِ السفليّةِ، فكلُّ مقطعٍ فيها كلمةٌ.
 * ويُبقى `subscription_price_amount` مارّاً بالسماحِ المُعلَنِ لا بضعفِ المطابقةِ.
 */
const WORD_BOUNDARY_LETTERS = /[\p{L}\p{N}]/u;

/** هل الكلمةُ حاضرةٌ ككلمةٍ كاملةٍ؟ بحدودٍ حرفيّةٍ تشملُ العربيّةَ. */
export function containsWord(haystack: string, word: string): boolean {
  const lower = haystack.toLowerCase();
  const needle = word.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : (lower[at - 1] ?? "");
    const after = lower[at + needle.length] ?? "";
    if (!WORD_BOUNDARY_LETTERS.test(before) && !WORD_BOUNDARY_LETTERS.test(after)) return true;
    from = at + 1;
  }
}

export interface WordHit {
  readonly path: string;
  readonly line: number;
  readonly word: string;
}

/** مواضعُ المفرداتِ الممنوعةِ في نصٍّ واحدٍ، سطراً سطراً. */
export function findForbiddenWords(
  path: string,
  source: string,
  words: readonly string[],
  dialect: "sql" | "ts" = "ts",
): readonly WordHit[] {
  const hits: WordHit[] = [];
  /**
   * التعليقُ يُفرَّغُ قبلَ المطابقةِ بالوحدةِ المشتركةِ `scripts/lib/blank-comments.ts`
   * — لا بنسخةٍ محلّيّةٍ. **ولماذا؟** لأنَّ تلكَ الوحدةَ وُلِدَت من عيبٍ مقيسٍ في
   * `F1-10`: نسخةٌ منسوخةٌ كانَت تُعامِلُ `//` في `https://` بدايةَ تعليقٍ فتُفرِّغُ
   * كلَّ عنوانٍ، فمرَّ ثلاثةُ مساببرَ محقونةٍ بخروجِ صفرٍ (`ADR 0045` §٧). ونسخةٌ
   * رابعةٌ ههنا تُعيدُ العيبَ نفسَه وتُخالِفُ القاعدةَ 0.6.
   *
   * **ولماذا يُستثنى التعليقُ أصلاً؟** لأنَّ المحكومَ عليه في القاعدةِ الأولى
   * **هيكلٌ** لا ذِكرٌ: حقلٌ أو عمودٌ أو مفتاحُ حمولةٍ أو مُعرِّفٌ. وحاجزٌ يُسقِطُ
   * CI على جملةٍ تشرحُ المنعَ يُعلِّمُ الفريقَ أن يحذفَ الشرحَ، فيبقى المنعُ
   * مفروضاً بلا أحدٍ يعرفُ لِمَ فُرِضَ — وذاكَ أخطرُ من ذِكرِ المفردةِ.
   *
   * وجسدُ الدالّةِ في SQL (`$fn$ … $fn$`) **لا يُفرَّغُ** في الوحدةِ المشتركةِ عن
   * قصدٍ، فيبقى مفحوصاً — وهوَ الموضعُ الذي قد يُدَسُّ فيه حقلُ أجرةٍ فعلاً.
   */
  const lines = (dialect === "sql" ? blankSqlComments(source) : blankComments(source)).split("\n");
  for (const [index, line] of lines.entries()) {
    if (isAllowedLine(line)) continue;
    for (const word of words) {
      if (containsWord(line, word)) hits.push({ path, line: index + 1, word });
    }
  }
  return hits;
}

/**
 * القاعدةُ ٨ — بيانُ طريقةِ الدفعِ **موجودٌ ومرسومٌ وقبلَ زرِّ الطلبِ**.
 *
 * وثلاثةُ توكيداتٍ لا واحدٌ، لأنَّ كلَّ واحدٍ منها يسقُطُ وحدَه:
 *
 * ١) **مفتاحٌ في القاموسِ لا يُرسَمُ لا يقولُ شيئاً لأحدٍ.** فيُشترَطُ ذِكرُ كلِّ
 *    مفتاحٍ في `QuoteScreen.tsx` نفسِها.
 * ٢) **مفتاحٌ مرسومٌ بلا نصٍّ يُعرَضُ خاماً.** فيُشترَطُ في اللغاتِ الثلاثِ.
 * ٣) **بيانٌ بعدَ الزرِّ ليسَ بياناً**: زرُّ `rider.quote.request` نقطةُ
 *    اللاعودةِ، فيُشترَطُ أن يَسبِقَه البيانُ في ترتيبِ الرسمِ — ويُقاسُ
 *    بموضعِ الحرفِ، فهوَ ما يراهُ القارئُ فعلاً.
 *
 * **ورابعٌ يَحرُسُ السماحَ نفسَه**: سطرٌ استُثنيَ بمفتاحِ بيانٍ يُفحَصُ بعدَ نزعِ
 * المفتاحِ منه، فلا يستترُ حقلُ أجرةٍ في ظلِّ سطرٍ مسموحٍ. وبذاكَ يبقى السماحُ
 * **مشروطاً بما سُمِحَ له** لا رخصةً للسطرِ كلِّه.
 */
export function findPaymentDisclosureViolations(
  screenSource: string | null | undefined,
  dictionaries: Readonly<Record<string, Readonly<Record<string, string>> | undefined>>,
): readonly string[] {
  const violations: string[] = [];
  for (const language of LANGUAGES) {
    const dictionary = dictionaries[language] ?? {};
    for (const key of PAYMENT_DISCLOSURE_KEYS) {
      const text = dictionary[key];
      if (typeof text !== "string" || text.trim().length === 0) {
        violations.push(
          `بيانُ طريقةِ الدفعِ: المفتاحُ «${key}» غائبٌ أو فارغٌ في «${language}.json» — والخطوةُ ٩ تُوجِبُ بياناً **مقروءاً** قبلَ الطلبِ، ومفتاحٌ خامٌّ ليسَ بياناً.`,
        );
      }
    }
  }
  if (typeof screenSource !== "string") return violations;
  const code = blankComments(screenSource);
  let lastDisclosureAt = -1;
  for (const key of PAYMENT_DISCLOSURE_KEYS) {
    const at = code.indexOf(key);
    if (at < 0) {
      violations.push(
        `بيانُ طريقةِ الدفعِ: المفتاحُ «${key}» غيرُ مرسومٍ في «QuoteScreen.tsx» — مفتاحٌ في القاموسِ لا يُرسَمُ لا يقولُ شيئاً لراكبٍ، وخضرةٌ عليه خضرةٌ كاذبةٌ.`,
      );
      continue;
    }
    if (at > lastDisclosureAt) lastDisclosureAt = at;
  }
  const requestAt = code.indexOf('"rider.quote.request"');
  if (requestAt >= 0 && lastDisclosureAt > requestAt) {
    violations.push(
      "بيانُ طريقةِ الدفعِ يُرسَمُ **بعدَ** زرِّ الطلبِ — والزرُّ نقطةُ اللاعودةِ: لا شاشةَ تأكيدٍ بعدَه بل يُنشَأُ الطلبُ فوراً. فبيانٌ بعدَه إخبارٌ بما لا يُرَدُّ.",
    );
  }
  for (const [index, line] of code.split("\n").entries()) {
    const matched = PAYMENT_DISCLOSURE_LITERALS.filter((key) => line.includes(key));
    if (matched.length === 0) continue;
    let rest = line;
    for (const key of matched) rest = rest.split(key).join(" ");
    for (const word of FORBIDDEN_FARE_WORDS) {
      if (containsWord(rest, word)) {
        violations.push(
          `«QuoteScreen.tsx:${index + 1}» يستترُ فيه «${word}» في ظلِّ سطرٍ استُثنيَ بمفتاحِ بيانٍ — والسماحُ مشروطٌ بالمفتاحِ وحدَه لا برخصةٍ للسطرِ كلِّه.`,
        );
      }
    }
  }
  return violations;
}

const ARABIC_LETTERS = /[\u0620-\u064A]/u;

/**
 * نصٌّ عربيٌّ داخلَ حرفيٍّ في شِفرةِ العميلِ. والتعليقاتُ مستثناةٌ: الشرحُ
 * بالعربيّةِ **واجبٌ** في هذا المستودعِ، والممنوعُ أن يُعرَضَ نصٌّ من الشِّفرةِ
 * بدلَ مفتاحٍ من القاموسِ.
 */
export function findArabicLiterals(path: string, source: string): readonly WordHit[] {
  const hits: WordHit[] = [];
  for (const [index, code] of blankComments(source).split("\n").entries()) {
    for (const match of code.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g)) {
      const value = match[1] ?? match[2] ?? match[3] ?? "";
      if (ARABIC_LETTERS.test(value)) {
        hits.push({ path, line: index + 1, word: value.slice(0, 40) });
      }
    }
  }
  return hits;
}

/**
 * القاعدةُ ٩ — بيانُ الدفعِ في **بابِ البوتِ** كذلكَ (`ADR 0170`).
 *
 * القاعدةُ ٨ حرسَت `QuoteScreen` وحدَها، **والطلبُ يُنشَأُ من بابَينِ**:
 * `apps/gateway` ← المِنِي آب، و`rider-dialog.ts` ← تلغرام مباشرةً عبرَ
 * `deps.rides.create`. **فحاجزٌ يحرُسُ باباً ويترُكُ باباً يُقرأُ إنفاذاً وهوَ
 * نصفُ إنفاذٍ** — والنصفُ في هذا البابِ أخطرُ لأنَّه الأقدمُ والأكثرُ استعمالاً.
 *
 * وفي البوتِ **لا شاشةَ تأكيدٍ** ولا ترتيبَ حرفٍ يُقاسُ كما في شاشةٍ، فآخرُ ما
 * يُقرأُ قبلَ نقطةِ اللاعودةِ هوَ **طلبُ المُدخَلِ الأخيرِ**. ولذا يُحرَسُ
 * **بنيويّاً**: لا يُطلَبُ مُدخَلٌ أخيرٌ إلّا من مَعبَرٍ واحدٍ يُرسِلُ البيانَ قبلَه.
 *
 * أربعةُ أحكامٍ:
 * ١) `rider.payment_notice` موجودٌ غيرُ فارغٍ في اللغاتِ الثلاثِ.
 * ٢) والمَعبَرُ `askFinalInputBeforeOrder` موجودٌ **ويُرسِلُ المفتاحَ**.
 * ٣) وكلُّ ذكرٍ لمفتاحِ مُدخَلٍ أخيرٍ لا يكونُ إلّا في سطرِ نداءِ المَعبَرِ أو في
 *    توقيعِه — فمسارٌ جديدٌ يطلبُ وجهةً بنفسِه يُسقِطُ البناءَ.
 * ٤) ولا **دعوى أجرةٍ** في قاموسِ الراكبِ: «سعرٌ تقديريٌّ» أو «تأكيدُ الطلبِ» أو
 *    «تتفقان على الأجرة عبرَ البوتِ» — وثلاثتُها كانت مكتوبةً فعلاً، والأخيرةُ
 *    تُوهِمُ بمُساومةٍ داخلَ التطبيقِ لا وجودَ لها.
 */
export const BOT_PAYMENT_NOTICE_KEY = "rider.payment_notice";
export const FINAL_INPUT_KEYS: readonly string[] = ["rider.ask_dropoff", "rider.ask_parcel"];
export const FINAL_INPUT_GATE = "askFinalInputBeforeOrder";

/** دعاوى أجرةٍ كانت مكتوبةً في قاموسِ البوتِ — تُمنَعُ بنصِّها لا بتخمينٍ. */
export const FORBIDDEN_BOT_FARE_CLAIMS: readonly string[] = [
  "السعر التقديري",
  "أكّد الطلب",
  "عبر البوت.",
  "estimated fare",
  "confirm the order",
  "through the bot.",
  "اندازاً کرایہ",
  "تصدیق کریں ✅",
  "بوٹ کے ذریعے",
];

export function findBotPaymentDisclosureViolations(
  dialogSource: string | null,
  dictionaries: Readonly<Record<string, Record<string, string>>>,
): readonly string[] {
  const violations: string[] = [];

  // ١) المفتاحُ في اللغاتِ الثلاثِ.
  for (const language of LANGUAGES) {
    const text = dictionaries[language]?.[BOT_PAYMENT_NOTICE_KEY];
    if (typeof text !== "string" || text.trim().length === 0) {
      violations.push(
        `القاعدةُ ٩: «${BOT_PAYMENT_NOTICE_KEY}» غائبٌ أو فارغٌ في «${language}.json» — فالراكبُ في تلغرام يُنشئُ رحلةً وهوَ لا يعلمُ كيفَ يدفعُ، والصمتُ ههنا إيهامٌ لا حيادٌ.`,
      );
    }
  }

  // ٤) دعاوى الأجرةِ في كلِّ نصوصِ الراكبِ.
  for (const language of LANGUAGES) {
    for (const [key, text] of Object.entries(dictionaries[language] ?? {})) {
      if (!key.startsWith("rider.")) continue;
      if (typeof text !== "string") continue;
      for (const claim of FORBIDDEN_BOT_FARE_CLAIMS) {
        if (text.includes(claim)) {
          violations.push(
            `القاعدةُ ٩: «${key}» في «${language}.json» يحملُ دعوى «${claim}» — ولا سعرَ تُحسِبُه وَصْلة ولا خطوةَ تأكيدٍ في البوتِ ولا مُساومةَ أجرةٍ داخلَه، فهذا وعدٌ بما لا يقعُ.`,
          );
        }
      }
    }
  }

  // الحاجزُ لا يمرُّ حيثُ لا يقرأُ.
  if (dialogSource === null) {
    violations.push(
      `القاعدةُ ٩: «${RIDER_DIALOG_FILE}» غيرُ مقروءٍ — وحاجزٌ يخرُجُ أخضرَ عن تعذُّرِ قراءةٍ أسوأُ من غيابِه (\`ADR 0167\`).`,
    );
    return violations;
  }

  // ٢) المَعبَرُ موجودٌ ويُرسِلُ البيانَ.
  const gateIndex = dialogSource.indexOf(`function ${FINAL_INPUT_GATE}`);
  if (gateIndex === -1) {
    violations.push(
      `القاعدةُ ٩: لا مَعبَرَ «${FINAL_INPUT_GATE}» في حوارِ الراكبِ — وبيانٌ مبثوثٌ في كلِّ فرعٍ يُنسى في الفرعِ التالي.`,
    );
  } else {
    const body = dialogSource.slice(gateIndex, gateIndex + 1200);
    if (!body.includes(`"${BOT_PAYMENT_NOTICE_KEY}"`)) {
      violations.push(
        `القاعدةُ ٩: مَعبَرُ «${FINAL_INPUT_GATE}» لا يُرسِلُ «${BOT_PAYMENT_NOTICE_KEY}» — مَعبَرٌ بلا بيانٍ بابٌ سُمِّيَ حاجزاً.`,
      );
    }
  }

  /*
   * والسماحُ يُفحَصُ بعدَ نزعِه: سطرٌ استُثنيَ بمفتاحِ البيانِ لا يصيرُ سطراً
   * حرّاً. وهذا ما أمسكَ أصنافَ العرضِ في القاعدةِ ٨، فيُطبَّقُ ههنا سلفاً.
   */
  for (const [index, rawLine] of dialogSource.split("\n").entries()) {
    if (!rawLine.includes(BOT_PAYMENT_NOTICE_LITERAL)) continue;
    const stripped = rawLine.split(BOT_PAYMENT_NOTICE_LITERAL).join(" ");
    for (const word of FORBIDDEN_FARE_WORDS) {
      if (containsWord(stripped, word)) {
        violations.push(
          `القاعدةُ ٩: السطرُ ${index + 1} استُثنيَ ببيانِ الدفعِ ثمَّ بقيَ فيه «${word}» بعدَ نزعِ المفتاحِ — والسماحُ للمفتاحِ لا لِما جاورَه.`,
        );
      }
    }
  }

  // ٣) ولا يُطلَبُ مُدخَلٌ أخيرٌ من غيرِ المَعبَرِ.
  const lines = dialogSource.split("\n");
  for (const key of FINAL_INPUT_KEYS) {
    const literal = `"${key}"`;
    let seen = 0;
    for (const [index, line] of lines.entries()) {
      if (!line.includes(literal)) continue;
      seen += 1;
      const throughGate = line.includes(`${FINAL_INPUT_GATE}(`) || line.includes(`| "${key}"`);
      const inSignature = line.trimStart().startsWith("key:") || line.includes(`key: "${key}"`);
      if (!throughGate && !inSignature) {
        violations.push(
          `القاعدةُ ٩: «${key}» مطلوبٌ في السطرِ ${index + 1} بغيرِ «${FINAL_INPUT_GATE}» — وهذا مُدخَلٌ أخيرٌ يُنشئُ الطلبَ فورَ وصولِه، فطلبُه بلا بيانِ دفعٍ هوَ العطبُ نفسُه في بابٍ آخرَ.`,
        );
      }
    }
    if (seen === 0) {
      violations.push(
        `القاعدةُ ٩: «${key}» لا يُطلَبُ في حوارِ الراكبِ ألبتَّةَ — ومفتاحٌ غابَ طلبُه يُبطِلُ الحُكمَ عليه بلا أن يُسقِطَ البناءَ، فيُسقَطُ صريحاً.`,
      );
    }
  }

  return violations;
}

export function findViolations(input: RepositoryInput): readonly string[] {
  const violations: string[] = [];
  const migrationSource = input.migrationSql;

  for (const path of SLICE_FILES) {
    if (input.sliceSources[path] === null || input.sliceSources[path] === undefined) {
      violations.push(`المِلفُّ «${path}» غائبٌ — عقدُ الاقتباسِ مُعلَنٌ في الحاجزِ بلا شِفرةٍ تخدمُه.`);
    }
  }

  // القاعدةُ ١ — لا مفردةَ أجرةٍ في الشريحةِ ولا في هجرتِها.
  const fareScanned: {
    readonly path: string;
    readonly source: string;
    readonly dialect: "sql" | "ts";
  }[] = [];
  for (const path of SLICE_FILES) {
    const source = input.sliceSources[path];
    if (typeof source === "string") fareScanned.push({ path, source, dialect: "ts" });
  }
  if (migrationSource !== null) {
    fareScanned.push({
      path: QUOTE_MIGRATION_SUFFIX,
      source: migrationSource,
      dialect: "sql",
    });
  }
  for (const { path, source, dialect } of fareScanned) {
    for (const hit of findForbiddenWords(path, source, FORBIDDEN_FARE_WORDS, dialect)) {
      violations.push(
        `«${hit.path}:${hit.line}» فيه مفردةُ أجرةٍ «${hit.word}» — آليّةُ الأجرةِ محجوبةٌ على قرارٍ نظاميٍّ مكتوبٍ (\`ADR 0039\` §٤ و§٦)، و\`م13-7\` يُجمِّدُ حتّى الهياكلَ التمهيديّةَ. ولا يُفَكُّ الحجبُ بشِفرةٍ بل بسندٍ.`,
      );
    }
    // القاعدةُ ٧ — ولا سرعةَ ثابتةً ولا معاملَ التفافٍ.
    for (const hit of findForbiddenWords(path, source, FORBIDDEN_SPEED_WORDS, dialect)) {
      violations.push(
        `«${hit.path}:${hit.line}» فيه «${hit.word}» — \`ADR 0024\` يمنعُ اختراعَ الزمنِ من المسافةِ بقياسٍ: نسبةُ الالتفافِ المقيسةُ تراوحَت بينَ 1.124 و2.834.`,
      );
    }
  }

  // القاعدةُ ٥ — لا نصَّ معروضاً في شِفرةِ العميلِ.
  for (const path of CLIENT_TEXT_FILES) {
    const source = input.sliceSources[path];
    if (typeof source !== "string") continue;
    for (const hit of findArabicLiterals(path, source)) {
      violations.push(
        `«${hit.path}:${hit.line}» فيه نصٌّ معروضٌ «${hit.word}…» — الشاشةُ تُعيدُ مفاتيحَ والنصُّ في \`packages/shared/i18n\` (§9.11)، وإلّا بقيَت لغةٌ واحدةٌ محفورةً في الشِّفرةِ.`,
      );
    }
  }

  if (migrationSource === null) {
    violations.push(
      `لا هجرةَ تنتهي بـ«${QUOTE_MIGRATION_SUFFIX}» — حكمُ الاقتباسِ مُعلَنٌ في الشِّفرةِ بلا دالّةٍ تخدمُه (القاعدة 0.5).`,
    );
    return violations;
  }

  /**
   * تُقرأُ القواعدُ ٢ و٣ و٦ من **الشِّفرةِ المُنفَّذةِ** لا من نصِّ الهجرةِ كما هوَ.
   * وهذا إصلاحُ ثُغرةٍ حقيقيّةٍ أمسكَتها الحالةُ السالبةُ: نزعٌ مُعلَّقٌ
   * (`-- revoke execute …`) كانَ يُقرأُ نزعاً مُنفَّذاً، فيُقرَأُ الحاجزُ أخضرَ
   * والدالّةُ مفتوحةٌ للمفتاحِ العامِّ. وجسدُ الدالّةِ (`$fn$ … $fn$`) لا يُفرَّغُ
   * فيبقى مفحوصاً.
   */
  const migration = blankSqlComments(migrationSource);

  // القاعدةُ ٢ — المسافةُ لا تُنشَرُ إلّا موسومةً.
  const distanceValues = [...migration.matchAll(/'distance_m'/g)].length;
  const distanceKinds = [...migration.matchAll(/'distance_kind'/g)].length;
  if (distanceValues === 0) {
    violations.push(
      "الهجرةُ لا تُعيدُ «distance_m» — فلا مسافةَ تُقاسُ في القاعدةِ، والحسبةُ في التطبيقِ تُخالِفُ القاعدةَ 0.5.",
    );
  }
  if (distanceKinds < distanceValues) {
    violations.push(
      `الهجرةُ تُعيدُ «distance_m» ${distanceValues} مرّةً و«distance_kind» ${distanceKinds} — مسافةٌ بلا وسمٍ تُقرأُ طولَ طريقٍ، وقد قاسَ \`ADR 0024\` فارقاً يبلغُ 2.834 ضِعفاً.`,
    );
  }
  if (!migration.includes("'STRAIGHT_LINE'")) {
    violations.push(
      "الهجرةُ لا تُصرِّحُ بالوسمِ «STRAIGHT_LINE» — الوسمُ قيمةٌ مُعلَنةٌ لا استنتاجٌ في العميلِ.",
    );
  }
  const contract = input.sliceSources["packages/domain/quote/distance-kind.ts"];
  if (typeof contract === "string" && !/readonly\s+kind\s*:\s*DistanceKind/.test(contract)) {
    violations.push(
      "عقدُ `TaggedDistance` بلا حقلِ `kind` إلزاميٍّ — حقلٌ اختياريٌّ يُنسى في أوّلِ تمريرٍ بينَ طبقتَينِ ولا يُنبِّهُ المُصرِّفُ.",
    );
  }

  // القاعدةُ ٣ — رفضا منطقةِ الخدمةِ مفصولانِ في القاعدةِ وفي العقدِ وفي النصِّ.
  const refusals = new Set(
    [...migration.matchAll(/'error'\s*,\s*'([A-Z_]+)'/g)].map((match) => match[1] as string),
  );
  for (const code of ["ORIGIN_OUTSIDE_SERVICE_AREA", "DESTINATION_OUTSIDE_SERVICE_AREA"]) {
    if (!refusals.has(code)) {
      violations.push(
        `الهجرةُ لا تُعيدُ «${code}» — جمعُ رفضِ الانطلاقِ ورفضِ الوجهةِ في رمزٍ واحدٍ يجعلُ الشاشةَ تنصحُ الراكبَ بتصحيحِ ما لم يُخطئْ فيه.`,
      );
    }
  }
  const ports = input.sliceSources["packages/application/quote/ports.ts"];
  if (typeof ports === "string") {
    for (const code of ["ORIGIN_OUTSIDE_SERVICE_AREA", "DESTINATION_OUTSIDE_SERVICE_AREA"]) {
      if (!ports.includes(code)) {
        violations.push(
          `عقدُ المنافذِ لا يعرفُ «${code}» — رمزٌ تُعيدُه القاعدةُ ولا يعرفُه التطبيقُ يُترجَمُ عطباً بدلَ سببِه.`,
        );
      }
    }
  }

  /**
   * وتمامُ القاعدةِ ٣: **كلُّ رمزِ رفضٍ تُعيدُه الهجرةُ له مفتاحٌ في نموذجِ
   * العرضِ.** ورمزٌ تُعيدُه القاعدةُ ولا يعرفُه العرضُ يهبطُ إلى «لا نستطيعُ
   * اقتباسَ هذه الرحلةِ» — نصٌّ صادقٌ في ظاهرِه يُخفي سبباً كانَ الراكبُ يقدرُ
   * على إصلاحِه، وهوَ أسوأُ أنواعِ الصدقِ. ويُقرأُ الجانبانِ من الشكلِ لا من
   * قائمةٍ ثالثةٍ مكتوبةٍ في الحاجزِ (القاعدة 0.6).
   */
  const viewSource = input.sliceSources["apps/miniapp/src/surfaces/rider/quote/quote-view.ts"];
  if (typeof viewSource === "string") {
    const block = /const REFUSAL_KEYS[^{]*\{([\s\S]*?)\}/.exec(blankComments(viewSource));
    const mapped = new Set(
      [...(block?.[1] ?? "").matchAll(/([A-Z_]+)\s*:/g)].map((match) => match[1] as string),
    );
    for (const code of refusals) {
      if (NON_REFUSAL_ERROR_CODES.includes(code)) continue;
      if (!mapped.has(code)) {
        violations.push(
          `نموذجُ العرضِ لا يُترجِمُ رمزَ الرفضِ «${code}» — فيهبطُ إلى نصٍّ عامٍّ ويُحجَبُ عن الراكبِ سببٌ كانَ يقدرُ على إصلاحِه.`,
        );
      }
    }
  }

  // القاعدةُ ٤ — المدّةُ من النطاقِ وحدَه.
  const useCase = input.sliceSources["packages/application/quote/quote-ride.ts"];
  if (typeof useCase === "string" && !useCase.includes("estimateArrival")) {
    violations.push(
      "حالةُ الاقتباسِ لا تستدعي `estimateArrival` — المدّةُ حكمُ `packages/domain/eta` معَ امتناعِه المُصنَّفِ، وحسبةٌ ثانيةٌ ههنا مصدرُ حقيقةٍ ثانٍ (القاعدة 0.6).",
    );
  }
  const clientView = input.sliceSources["apps/miniapp/src/surfaces/rider/quote/quote-view.ts"];
  if (
    typeof clientView === "string" &&
    /(\b(?:60|3600)\s*[*/])|([*/]\s*(?:60|3600)\b)/.test(blankComments(clientView))
  ) {
    violations.push(
      "نموذجُ العرضِ يحسبُ زمناً بالقسمةِ أو الضربِ — العرضُ يُنسِّقُ ما حكمَ به النطاقُ ولا يُعيدُ حسابَه.",
    );
  }

  // القاعدةُ ٦ — نزعُ التنفيذِ عن الأدوارِ العامّةِ.
  for (const signature of REVOKED_FUNCTIONS) {
    const pattern = new RegExp(
      `revoke\\s+execute\\s+on\\s+function\\s+${signature.replace(/[()]/g, (c) => `\\${c}`)}\\s+from\\s+([^;]+);`,
      "i",
    );
    const match = migration.match(pattern);
    if (match === null) {
      violations.push(
        `الهجرةُ لا تنزعُ التنفيذَ عن «${signature}» — دالّةٌ تقرأُ مدينةَ صاحبِ معرّفٍ مفتوحةً للمفتاحِ العامِّ بابُ تعدادٍ.`,
      );
      continue;
    }
    const roles = (match[1] ?? "").toLowerCase();
    for (const role of REVOKED_ROLES) {
      if (!roles.includes(role)) {
        violations.push(
          `«${signature}» لا يُنزَعُ تنفيذُها عن الدورِ «${role}» — ونزعٌ ناقصٌ يُقرأُ إغلاقاً وهوَ بابٌ مفتوحٌ.`,
        );
      }
    }
  }

  // القاعدةُ ٥ (تكملةً) — المفاتيحُ في اللغاتِ الثلاثِ.
  const keys = [
    ...REQUIRED_QUOTE_KEYS,
    ...SERVICE_KINDS.map((service) => `rider.quote.service.${service}`),
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

  // القاعدةُ ٨ — بيانُ طريقةِ الدفعِ قبلَ الطلبِ (الخطوةُ ٩).
  violations.push(
    ...findPaymentDisclosureViolations(
      input.sliceSources["apps/miniapp/src/surfaces/rider/quote/QuoteScreen.tsx"],
      input.miniappDictionaries,
    ),
  );

  // القاعدةُ ٩ — بيانُ الدفعِ في بابِ البوتِ (`ADR 0170`).
  violations.push(
    ...findBotPaymentDisclosureViolations(input.riderDialogSource, input.botDictionaries),
  );

  return violations;
}

if (import.meta.main) {
  const violations = findViolations(readRepository());
  if (violations.length === 0) {
    console.log(
      `حاجزُ عقدِ الاقتباسِ: نجحَ — ${SLICE_FILES.length} مِلفّاً مفحوصاً بـ${FORBIDDEN_FARE_WORDS.length} مفردةَ أجرةٍ ممنوعةً و${FORBIDDEN_SPEED_WORDS.length} مفردةَ اختراعٍ زمنيٍّ، مسافةٌ موسومةٌ في القاعدةِ والعقدِ، رمزا رفضٍ مفصولانِ، ${REVOKED_FUNCTIONS.length} دالّتَينِ منزوعتَي التنفيذِ عن ${REVOKED_ROLES.length} أدوارٍ، و${REQUIRED_QUOTE_KEYS.length + SERVICE_KINDS.length} مفتاحاً في ثلاثِ لغاتٍ، وبيانُ طريقةِ الدفعِ بـ${PAYMENT_DISCLOSURE_KEYS.length} مفاتيحَ مرسومةٍ قبلَ زرِّ الطلبِ، وبابُ البوتِ يُبيِّنُ قبلَ ${FINAL_INPUT_KEYS.length} مُدخَلَينِ أخيرَينِ بلا ${FORBIDDEN_BOT_FARE_CLAIMS.length} دعوى أجرةٍ.`,
    );
  } else {
    console.error("حاجزُ عقدِ الاقتباسِ: سقطَ.");
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
  }
}
