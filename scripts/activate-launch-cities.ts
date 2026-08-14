/**
 * الغرض: تفعيلُ مدنِ الإطلاق **معاً** — القسم ٣ من أمر الإطلاق: المدنُ الخمسُ
 *   تُفتح في وقتٍ واحد، لا مدينةٌ ثمّ مدينة. يقرأ بيانَ المدن من ملفٍ خارجَ
 *   المستودع، ويُفعّل كلَّ مدينةٍ بالدالّة الذرّية `admin_update_city_group_ids`
 *   لا بـ`UPDATE` خام، ويرفض التفعيلَ الجزئيّ: إمّا الكلُّ أو لا أحد.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: مشغّلُ الإطلاق على قاعدةِ الإنتاج، ومهيّئُ قاعدةِ
 *   الاختبار قبل تشغيلِ اختباراتِ المدنِ الخمس.
 * ملاحظات مستقبلية: زيادةُ مدينةٍ سادسةٍ لا تمسّ هذا الملفّ — تُبذَر المدينةُ في
 *   هجرةٍ وتُضاف سطراً في البيان. وإن صار للمدينة قروبٌ رابع فالحقلُ يُضاف إلى
 *   `admin_update_city_group_ids` ثمّ إلى البيان، لا إلى `UPDATE` هنا.
 *
 * لماذا سكربتٌ ثانٍ ولم يُوسَّع `activate-pilot-city.ts`: ذاك يُفعّل مدينةً
 * واحدةً بعد التحقّق منها، وهو لازمٌ لعلاجِ مدينةٍ بعينها بعد الإطلاق (تغيّر
 * قروبها مثلاً). أمّا الإطلاق فحدثٌ واحدٌ ذو شرطٍ مختلف: أن تصير الخمسُ مفعّلةً
 * أو لا تصير أيّةُ واحدةٍ منها. ودمجُ الحالتين في سكربتٍ واحدٍ بمُعامِلٍ اختياريّ
 * يُنتج سكربتاً يُفعّل مدينةً واحدةً وهو يُظنُّ أنّه أطلق الخمس.
 *
 * لماذا البيانُ ملفٌّ خارج المستودع: معرّفاتُ القروبات قيمٌ تشغيليّةٌ تخصّ مالكاً
 * وحساباً، لا ثوابتَ منتَج. موضعُها الدائمُ عمودٌ في `cities`، وممرُّها بيانٌ
 * يُمرَّر مرّةً — لا سطرٌ في المستودع يُنسخ مع كلِّ فرعٍ ويُطلِق قروباً خطأً.
 */

import { createSql } from "../packages/infrastructure/db/client.ts";

/** مدنُ الإطلاق. القائمةُ هنا لأنّ «الخمسُ معاً» شرطٌ لا إعداد. */
export const LAUNCH_CITY_CODES = ["JED", "MKK", "RUH", "TIF", "MED"] as const;

export interface CityGroupIds {
  readonly code: string;
  /** قروبُ الدعم. */
  readonly supportGroupId: string;
  /** قروبُ التصعيد. */
  readonly escalationGroupId: string;
  /** قروبُ السائقين الذي تُنشر فيه بطاقاتُ الطلبات. */
  readonly driversGroupId: string;
}

export interface LaunchManifest {
  readonly adminTelegramId: string;
  readonly cities: readonly CityGroupIds[];
}

const MIN_BIGINT = -(2n ** 63n);
const MAX_BIGINT = 2n ** 63n - 1n;

function parseGroupId(value: unknown, label: string): bigint {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${label}: معرّفُ القروب مفقودٌ أو ليس رقماً.`);
  }
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) {
    throw new Error(`${label}: معرّفُ القروب يجب أن يكون عدداً صحيحاً، والسالبُ مقبولٌ للقروبات.`);
  }
  const parsed = BigInt(text);
  if (parsed === 0n || parsed < MIN_BIGINT || parsed > MAX_BIGINT) {
    throw new Error(`${label}: معرّفُ القروب صفرٌ أو خارجَ نطاقِ bigint.`);
  }
  return parsed;
}

/**
 * يتحقّق من البيان قبل أيّ اتصالٍ بالقاعدة. دالّةٌ نقيّةٌ لتُختبر بلا قرصٍ ولا شبكة.
 *
 * الشروطُ ليست تجميلاً: قروبٌ واحدٌ مشتركٌ بين مدينتين يعني أن سائقَ جدة يرى
 * طلبَ الرياض ويقبله، فتنكسر عزلةُ المدن من بابِ الإعداد لا من بابِ الكود —
 * ولا قيدَ في القاعدة يمنعُ ذلك: `cities_group_ids_distinct_*` تحرس التمايزَ
 * **داخل** المدينة لا بينها.
 */
export function validateManifest(raw: unknown): LaunchManifest {
  if (typeof raw !== "object" || raw === null) throw new Error("البيان ليس كائن JSON.");
  const source = raw as Record<string, unknown>;
  const adminTelegramId = String(source["adminTelegramId"] ?? "").trim();
  if (!/^\d+$/.test(adminTelegramId)) {
    throw new Error("adminTelegramId مفقودٌ أو ليس معرّفَ تلغرام صحيحاً.");
  }
  if (!Array.isArray(source["cities"])) throw new Error("cities يجب أن تكون قائمة.");

  const cities: CityGroupIds[] = [];
  const seenCodes = new Set<string>();
  const seenGroups = new Map<string, string>();
  for (const entry of source["cities"] as readonly unknown[]) {
    if (typeof entry !== "object" || entry === null) throw new Error("مدخلُ مدينةٍ ليس كائناً.");
    const city = entry as Record<string, unknown>;
    const code = String(city["code"] ?? "").trim();
    if (!/^[A-Z][A-Z0-9_]{1,15}$/.test(code)) {
      throw new Error(`رمزُ المدينة «${code}» يجب أن يكون أحرفاً وأرقاماً إنجليزيّةً كبيرة.`);
    }
    if (seenCodes.has(code)) throw new Error(`المدينة ${code} مذكورةٌ مرّتين في البيان.`);
    seenCodes.add(code);

    const support = parseGroupId(city["supportGroupId"], `${code}/دعم`);
    const escalation = parseGroupId(city["escalationGroupId"], `${code}/تصعيد`);
    const drivers = parseGroupId(city["driversGroupId"], `${code}/سائقين`);
    if (new Set([support, escalation, drivers]).size !== 3) {
      throw new Error(`${code}: القروباتُ الثلاثةُ يجب أن تحمل معرّفاتٍ مختلفة.`);
    }
    for (const [id, label] of [
      [support, "دعم"],
      [escalation, "تصعيد"],
      [drivers, "سائقين"],
    ] as const) {
      const key = id.toString();
      const owner = seenGroups.get(key);
      if (owner !== undefined) {
        throw new Error(
          `قروبٌ واحدٌ لمدينتين: ${label} في ${code} هو نفسُه قروبُ ${owner} — ` +
            "سائقٌ في قروبٍ مشتركٍ يرى طلبَ مدينةٍ أخرى ويقبله.",
        );
      }
      seenGroups.set(key, `${code}/${label}`);
    }
    cities.push({
      code,
      supportGroupId: support.toString(),
      escalationGroupId: escalation.toString(),
      driversGroupId: drivers.toString(),
    });
  }

  const missing = LAUNCH_CITY_CODES.filter((code) => !seenCodes.has(code));
  if (missing.length > 0) {
    throw new Error(
      `الإطلاقُ خمسُ مدنٍ معاً (القسم ٣): ناقصٌ في البيان ${missing.join("، ")}. ` +
        "لتفعيلِ مدينةٍ واحدةٍ بعد الإطلاق استعمل scripts/activate-pilot-city.ts.",
    );
  }
  return { adminTelegramId, cities };
}

function usage(message: string): never {
  throw new Error(
    `${message}\n` + "الاستخدام: bun scripts/activate-launch-cities.ts --manifest <مسار ملف JSON>",
  );
}

interface CityOutcome {
  readonly code: string;
  readonly changed: boolean;
  readonly isActive: boolean;
}

async function activate(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] !== "--manifest" || argv[1] === undefined || argv.length !== 2) {
    usage("المعاملات غير صحيحة.");
  }
  const manifestPath = argv[1];
  const manifest = validateManifest(await Bun.file(manifestPath).json());

  const connectionString = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (connectionString === undefined || connectionString.trim() === "") {
    throw new Error("DATABASE_URL مطلوب للاتصال بالقاعدة.");
  }

  const sql = createSql({ connectionString });
  try {
    const outcomes = await sql.begin(async (tx) => {
      const admins = await tx<{ id: string; role: string; is_blocked: boolean }[]>`
        select id, role, is_blocked from users where telegram_id = ${manifest.adminTelegramId}::bigint
      `;
      const admin = admins[0];
      if (admin === undefined) {
        throw new Error(
          "لا مستخدمَ بمعرّفِ التلغرام المذكور. المسارُ الرسميّ: يُرسل المالكُ /start " +
            "لبوتِ المسؤول أوّلاً (BOOTSTRAP_ADMIN_TELEGRAM_ID) فتُنشأ هويّتُه ثمّ يُمنح الدور.",
        );
      }
      if (admin.role !== "admin" || admin.is_blocked) {
        throw new Error(
          "المستخدمُ موجودٌ لكنّه ليس مسؤولاً غيرَ محظور — الدورُ يُمنح بـgrant_bootstrap_admin.",
        );
      }

      const results: CityOutcome[] = [];
      for (const city of manifest.cities) {
        const rows = await tx<{ id: string }[]>`
          select id from cities where code = ${city.code}
        `;
        const found = rows[0];
        if (found === undefined) {
          throw new Error(`لا مدينةَ مزروعةً بالرمز ${city.code} — تُبذَر بهجرةٍ لا بهذا السكربت.`);
        }
        const applied = await tx<{ result: Record<string, unknown> }[]>`
          select admin_update_city_group_ids(
            ${admin.id}::uuid,
            ${found.id}::uuid,
            ${city.supportGroupId}::bigint,
            ${city.escalationGroupId}::bigint,
            ${city.driversGroupId}::bigint
          ) as result
        `;
        const result = applied[0]?.result ?? {};
        if (result["ok"] !== true) {
          throw new Error(`${city.code}: رفضت الدالّةُ التفعيل (${String(result["error"])}).`);
        }
        if (result["is_active"] !== true) {
          throw new Error(`${city.code}: نُفّذ التحديثُ ولم تصر المدينةُ مفعّلة.`);
        }
        results.push({
          code: city.code,
          changed: result["changed"] === true,
          isActive: true,
        });
      }

      // الشرطُ الأخيرُ يُفحَص داخل المعاملة: لو بقيت مدينةٌ من الخمسِ خارجَ التفعيل
      // لأيّ سببٍ — بذرةٌ ناقصةٌ أو قيدٌ ردَّ الصفَّ — تُلفُّ المعاملةُ كلُّها.
      const active = await tx<{ code: string }[]>`
        select code from cities where is_active = true order by code
      `;
      const activeCodes = active.map((row) => row.code);
      const notActive = manifest.cities
        .map((city) => city.code)
        .filter((code) => !activeCodes.includes(code));
      if (notActive.length > 0) {
        throw new Error(`تفعيلٌ جزئيّ مرفوض: بقيت ${notActive.join("، ")} غيرَ مفعّلة.`);
      }
      return { results, activeCodes };
    });

    for (const outcome of outcomes.results) {
      console.log(
        `✅ ${outcome.code}: مفعّلة${outcome.changed ? " (تغيّرت الآن)" : " (كانت مضبوطةً سلفاً)"}`,
      );
    }
    console.log(`المدنُ المفعّلةُ في القاعدة: ${outcomes.activeCodes.join("، ")}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  activate().catch((error: unknown) => {
    console.error(error instanceof Error ? `فشل تفعيلُ مدنِ الإطلاق: ${error.message}` : error);
    process.exitCode = 1;
  });
}
