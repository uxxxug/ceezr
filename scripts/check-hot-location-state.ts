#!/usr/bin/env bun
/**
 * # حاجزُ الحالةِ الساخنةِ للموقعِ — حَكَمٌ واحدٌ، ورقمٌ لا يُخترَعُ، وذرّيّةٌ لا تُنقَضُ
 *
 * **الغرض:** يفرضُ البندَ `F4-02` (حالةٌ ساخنةٌ مشتركةٌ لموقعِ السائقِ + استمرارٌ
 * غيرُ متزامنٍ مجمَّعٌ — `CAP-009`) بثمانِ قواعدَ تُقرأُ من المستودعِ نفسِه لا من
 * نيّةِ كاتبٍ. وكلُّ قاعدةٍ منها تُمسِكُ انحداراً وقعَ فعلاً أو يقعُ بسهولةٍ:
 *
 * ١) **حارسُ التسلسلِ في المخزنِ الساخنِ قائمٌ ومُتَّجِهٌ صحيحاً**: سكربتُ الكتابةِ
 *    يرفضُ **الأقدمَ** ويقبلُ المتساويَ. ولو انقلبَ المُسنَدُ (`>=` بدلَ `>`) صارَ
 *    المتساوي مرفوضاً فتجمَّدَت الخريطةُ عندَ حركةٍ سريعةٍ؛ ولو صارَ (`<`) قَبِلَ
 *    الأقدمَ فتراجعَ الموضعُ — وهوَ `BUG-001` بعينِه في مخزنٍ جديدٍ.
 *
 * ٢) **مُسنَدُ الدفعةِ هوَ مُسنَدُ الكتابةِ المباشرةِ حرفاً**: `<=` على
 *    `last_location_recorded_at` في الدالّةِ الذرّيّةِ كما في `updateLocation`.
 *    و`ADR 0053 §٦` يمنعُ حَكَمَينِ على «الأحدثِ»: مُسنَدانِ مختلفانِ على مخزنَينِ
 *    يعنيانِ موضعاً يُقبَلُ ههنا ويُرفَضُ هناكَ.
 *
 * ٣) **التنقيةُ داخلَ الدالّةِ لا في الشيفرةِ وحدَها**: `distinct on` في الدالّةِ.
 *    ودفعةٌ فيها إصلاحتانِ لسائقٍ واحدٍ بلا تنقيةٍ تُطبَّقُ **بترتيبٍ غيرِ
 *    محدَّدٍ** — فيُكتَبُ الأقدمُ ويُهمَلُ الأحدثُ صامتاً.
 *
 * ٤) **الدفعةُ مقيَّدةٌ بمدينةٍ**: `city_id = p_city_id` في جملةِ التحديثِ.
 *    القاعدةُ ٠.٤، وههنا خصوصاً: معرّفُ سائقٍ من مفتاحِ مدينةٍ خاطئٍ كانَ سيُكتَبُ.
 *
 * ٥) **الأرقامُ الأربعةُ مبذورةٌ في هجرةٍ**: مفتاحٌ غيرُ مبذورٍ يُقرأُ خرقاً دائماً
 *    في كلِّ مدينةٍ، فيُطفَأُ التجميعُ كلُّه بصمتٍ.
 *
 * ٦) **ولا افتراضَ لها في الشيفرةِ**: لا `??` برقمٍ في وحدةِ تفسيرِ الحدودِ. رقمٌ
 *    احتياطيٌّ في الشيفرةِ يجعلُ حِمْلَ القاعدةِ محكوماً بما لا يراهُ مالكٌ في لوحةٍ.
 *
 * ٧) **العمليّةُ المركَّبةُ سكربتٌ واحدٌ**: لا `HSET`/`ZADD`/`ZREM`/`HDEL`/`EXPIRE`
 *    يُرسَلُ أمراً مفرداً من المحوّلِ. من فكَّ سكربتاً إلى أمرَينِ أعادَ نافذةَ
 *    التزاحمِ التي وُجِدَ السكربتُ لإغلاقِها — «اقرأْ ثمَّ اكتبْ» بلا قفلٍ.
 *
 * ٨) **المنفذُ اختياريٌّ في حالةِ الاستخدامِ**: `hotState?` لا `hotState`. منفذٌ
 *    مفروضٌ يعني أنَّ عطلَ `Redis` يُسقِطُ استقبالَ الموقعِ كلَّه — والتدهوّرُ
 *    المُعلَنُ أن يُكتَبَ الموضعُ مباشرةً كما كانَ يُكتَبُ قبلَ هذا البندِ.
 *
 * **ينتمي إلى:** سلسلةَ حرّاسِ CI · خطوةً مُسمّاةً في `.github/workflows/ci.yml`.
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يلمسُ قاعدةً ولا Redis.** يقرأُ نصّاً. أنَّ الدالّةَ تُطبِّقُ الأحدثَ
 *   فعلاً، وأنَّ السكربتَ يرفضُ الأقدمَ فعلاً، يُثبَتُ في اختباراتِ التكاملِ على
 *   PostgreSQL حقيقيٍّ وRedis حقيقيٍّ لا ههنا. والنصُّ يُثبِتُ **وجودَ** المُسنَدِ
 *   لا **أثرَه**.
 * - **لا يحكمُ على صوابِ رقمٍ.** أنَّ عمرَ الحالةِ الساخنةِ مئةٌ وعشرونَ ثانيةً
 *   حكمُ تشغيلٍ يُعايَرُ بالقياسِ؛ المفروضُ ههنا أن يكونَ **في القاعدةِ** لا أن
 *   يكونَ صواباً.
 * - **لا يقيسُ حِمْلاً.** كم استعلاماً وفَّرَ التجميعُ سؤالُ قياسٍ (`F10-05`) لا
 *   سؤالُ حاجزٍ، ولا يُدَّعى ههنا رقمٌ فيه.
 * - **لا يفحصُ جدولَ تاريخِ المواقعِ المقسَّمَ.** هوَ شطرُ `CAP-009` الثالثُ وبندٌ
 *   لاحقٌ، وفحصُ ما لم يُبنَ يُقرأُ تغطيةً وهوَ فراغٌ.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DRIVER_LOCATION_BATCH_RPC,
  HOT_LOCATION_SETTING_KEYS,
} from "../packages/shared/config/driver-location-hot-state.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const LIMITS_MODULE = "packages/application/geo/driver-location-hot-state.ts";
const REDIS_ADAPTER = "packages/infrastructure/geo/redis-driver-location-hot-state.ts";
const USE_CASE = "packages/application/geo/update-driver-location.ts";
const DIRECT_WRITE = "packages/infrastructure/identity/directories.ts";

/** أوامرُ Redis التي لا يجوزُ إرسالُها مفردةً من المحوّلِ — تُغيِّرُ حالةً. */
const SINGLE_COMMAND_BAN: readonly string[] = ["HSET", "ZADD", "ZREM", "HDEL", "EXPIRE", "ZPOPMIN"];

export interface RepositorySources {
  /** نصُّ كلِّ الهجراتِ مجموعاً — القراءةُ على المجموعِ لأنَّ البذرَ قد يُقسَّمُ. */
  readonly migrations: string;
  readonly limitsModule: string;
  readonly redisAdapter: string;
  readonly useCase: string;
  readonly directWrite: string;
  readonly settingKeys: readonly string[];
}

export function readSources(): RepositorySources {
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
    .join("\n");
  return {
    migrations,
    limitsModule: readFileSync(LIMITS_MODULE, "utf8"),
    redisAdapter: readFileSync(REDIS_ADAPTER, "utf8"),
    useCase: readFileSync(USE_CASE, "utf8"),
    directWrite: readFileSync(DIRECT_WRITE, "utf8"),
    settingKeys: HOT_LOCATION_SETTING_KEYS,
  };
}

/**
 * جسمُ الدالّةِ الذرّيّةِ كما تُعلِنُه آخِرُ هجرةٍ تُعرِّفُها — آخِرُ تعريفٍ هوَ
 * الحاكمُ في القاعدةِ، فقراءةُ الأوّلِ كانت ستُجيزُ نسخةً ثانيةً تنقضُ الأولى.
 */
export function batchFunctionBody(migrations: string): string | null {
  const pattern = new RegExp(
    `create or replace function\\s+${DRIVER_LOCATION_BATCH_RPC}[\\s\\S]*?\\n\\$\\$;`,
    "g",
  );
  const matches = [...migrations.matchAll(pattern)];
  const last = matches.at(-1)?.[0];
  return last ?? null;
}

/**
 * سطورُ Lua المُقتبَسةُ في وحدةٍ — يُقرأُ منها المُسنَدُ. والاقتباسُ في المستودعِ
 * سطرٌ لكلِّ جملةٍ داخلَ مصفوفةٍ تُوصَلُ بـ`join`، فالقراءةُ سطرٌ سطرٌ صحيحةٌ.
 */
export function luaLines(module: string): string[] {
  return module
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith('"') && line.includes("redis.call"));
}

/** استدعاءاتُ `command([...])` المفردةُ للأمرِ المذكورِ — لا داخلَ Lua. */
export function issuesSingleCommand(module: string, command: string): boolean {
  return new RegExp(`command\\(\\s*\\[\\s*"${command}"`).test(module);
}

export function findViolations(sources: RepositorySources): string[] {
  const violations: string[] = [];

  // ١) حارسُ التسلسلِ في المخزنِ الساخنِ: يرفضُ الأقدمَ ويقبلُ المتساويَ.
  const script = sources.redisAdapter;
  const guardLine = script
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.includes("return {'stale'"));
  if (guardLine === undefined) {
    violations.push(
      "سكربتُ الكتابةِ الساخنةِ بلا فرعِ رفضٍ للأقدمِ (`return {'stale'`) — المخزنُ الساخنُ بلا حارسِ تسلسلٍ يُعيدُ تراجعَ الموضعِ (BUG-001).",
    );
  } else if (!/if\s+newest\s*>\s*incoming\s+then/.test(guardLine)) {
    violations.push(
      `مُسنَدُ حارسِ التسلسلِ في المخزنِ الساخنِ ليسَ «newest > incoming»: «${guardLine}». ` +
        "و`>=` يرفضُ المتساويَ فيُجمِّدُ الخريطةَ، و`<` يقبلُ الأقدمَ فيُرجِعُ الموضعَ إلى الوراءِ.",
    );
  }
  if (!luaLines(script).some((line) => line.includes("EXPIRE"))) {
    violations.push(
      "سكربتُ الكتابةِ الساخنةِ بلا `EXPIRE` — مفتاحٌ ساخنٌ بلا عمرٍ يبقى إلى الأبدِ ويحكمُ بموضعٍ مهجورٍ.",
    );
  }

  // ٢) مُسنَدُ الدفعةِ هوَ مُسنَدُ الكتابةِ المباشرةِ.
  const body = batchFunctionBody(sources.migrations);
  if (body === null) {
    violations.push(
      `لا هجرةَ تُعرِّفُ «${DRIVER_LOCATION_BATCH_RPC}» — الاستمرارُ المجمَّعُ بلا دالّةٍ ذرّيّةٍ يعني حلقةَ تحديثٍ في الشيفرةِ (نقضُ القاعدةِ ٠.٥).`,
    );
  } else {
    const batchGuard =
      /last_location_recorded_at is null[\s\S]{0,120}?last_location_recorded_at\s*<=/.test(body);
    if (!batchGuard) {
      violations.push(
        `مُسنَدُ حارسِ التسلسلِ غائبٌ أو مُضيَّقٌ في «${DRIVER_LOCATION_BATCH_RPC}»: المطلوبُ «last_location_recorded_at is null or last_location_recorded_at <= …» حرفاً كما في الكتابةِ المباشرةِ (ADR 0053 §٦).`,
      );
    }

    // ٣) التنقيةُ داخلَ الدالّةِ.
    if (!/distinct on/.test(body)) {
      violations.push(
        `«${DRIVER_LOCATION_BATCH_RPC}» بلا «distinct on» — دفعةٌ فيها إصلاحتانِ لسائقٍ تُطبَّقُ بترتيبٍ غيرِ محدَّدٍ فيُكتَبُ الأقدمُ صامتاً.`,
      );
    }

    // ٤) الدفعةُ مقيَّدةٌ بمدينةٍ.
    if (!/city_id\s*=\s*p_city_id/.test(body)) {
      violations.push(
        `«${DRIVER_LOCATION_BATCH_RPC}» تكتبُ بلا قيدِ «city_id = p_city_id» — نقضُ القاعدةِ ٠.٤ في جملةِ كتابةٍ.`,
      );
    }
  }
  if (
    !/last_location_recorded_at is null[\s\S]{0,200}?last_location_recorded_at\s*<=/.test(
      sources.directWrite,
    )
  ) {
    violations.push(
      "مُسنَدُ الكتابةِ المباشرةِ (`drivers.updateLocation`) تغيَّرَ — والحاجزُ يقيسُ الدفعةَ عليه، فتغييرُ أحدِهما بلا الآخرِ هوَ الحَكَمانِ اللذانِ يمنعُهما ADR 0053 §٦.",
    );
  }

  // ٥) الأرقامُ الأربعةُ مبذورةٌ في هجرةٍ.
  for (const key of sources.settingKeys) {
    const seeded = new RegExp(
      `insert into platform_settings[\\s\\S]{0,400}?'${key}'\\s*,\\s*'`,
      "i",
    ).test(sources.migrations);
    if (!seeded) {
      violations.push(
        `المفتاحُ «${key}» غيرُ مبذورٍ في أيِّ هجرةٍ — يُقرأُ خرقاً دائماً في كلِّ مدينةٍ فيُطفَأُ التجميعُ بصمتٍ.`,
      );
    }
  }

  // ٦) ولا افتراضَ رقميٌّ في وحدةِ تفسيرِ الحدودِ.
  const numericFallback = /\?\?\s*\d/.exec(sources.limitsModule);
  if (numericFallback !== null) {
    violations.push(
      `وحدةُ تفسيرِ حدودِ المسارِ الساخنِ فيها افتراضٌ رقميٌّ «${numericFallback[0]}» — الرقمُ من «platform_settings» وحدَها (القاعدةُ ٠.٤).`,
    );
  }
  for (const key of sources.settingKeys) {
    const inlined = new RegExp(`${key}[^\\n]{0,40}\\?\\?\\s*\\d`).test(sources.limitsModule);
    if (inlined) {
      violations.push(`المفتاحُ «${key}» له قيمةٌ احتياطيّةٌ في الشيفرةِ — رقمٌ خارجَ القاعدةِ.`);
    }
  }

  // ٧) العمليّةُ المركَّبةُ سكربتٌ واحدٌ لا أمرانِ.
  for (const command of SINGLE_COMMAND_BAN) {
    if (issuesSingleCommand(sources.redisAdapter, command)) {
      violations.push(
        `المحوّلُ يُرسِلُ «${command}» أمراً مفرداً — العمليّةُ المركَّبةُ سكربتُ Lua واحدٌ، وأمرانِ متتاليانِ نافذةُ تزاحمٍ (اقرأْ ثمَّ اكتبْ بلا قفلٍ).`,
      );
    }
  }
  if (!/"EVAL"/.test(sources.redisAdapter)) {
    violations.push("المحوّلُ بلا `EVAL` — لا سكربتَ ذرّيّاً فيه أصلاً.");
  }

  // ٨) المنفذُ اختياريٌّ في حالةِ الاستخدامِ.
  if (!/readonly hotState\?:/.test(sources.useCase)) {
    violations.push(
      "منفذُ الحالةِ الساخنةِ مفروضٌ في «updateDriverLocation» — عطلُ Redis يُسقِطُ استقبالَ الموقعِ كلَّه بدلَ أن يتدهوّرَ إلى الكتابةِ المباشرةِ (F4-01).",
    );
  }
  if (!/onHotStateDegraded/.test(sources.useCase)) {
    violations.push(
      "لا أثرَ لتدهوّرِ المسارِ الساخنِ في «updateDriverLocation» — تدهوّرٌ صامتٌ يُقرأُ في اللوحةِ نجاحاً تامّاً ثمَّ يُكتشَفُ من فاتورةِ القاعدةِ.",
    );
  }

  return violations;
}

function main(): void {
  const violations = findViolations(readSources());

  if (violations.length > 0) {
    console.error("❌ حاجزُ الحالةِ الساخنةِ للموقعِ أخفقَ:");
    for (const violation of violations) console.error(`   - ${violation}`);
    process.exit(1);
  }

  console.log(
    `✅ الحالةُ الساخنةُ للموقعِ محروسةٌ — ${HOT_LOCATION_SETTING_KEYS.length} مفاتيحَ مبذورةٍ بلا افتراضٍ في الشيفرةِ، ` +
      `ومُسنَدُ التسلسلِ واحدٌ في المخزنَينِ، و«${DRIVER_LOCATION_BATCH_RPC}» تُنقّي وتُقيِّدُ المدينةَ، ` +
      `و${SINGLE_COMMAND_BAN.length} أوامرَ حالةٍ لا تُرسَلُ إلّا داخلَ سكربتٍ ذرّيٍّ.`,
  );
}

// لا يُشغَّل `main` عندَ الاستيرادِ من اختبارٍ: `process.exit` كانَ سيقتلُ المُشغِّل.
if (import.meta.main) main();
