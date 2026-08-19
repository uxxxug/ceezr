/**
 * الغرض: ضبطُ قروبات **مدينةٍ واحدةٍ بعينها** وتفعيلُها، بعد التحقّق من معرّفات
 *   قروبات تيليجرام الثلاثة. أداةُ علاجٍ لمدينةٍ واحدة: قروبٌ تغيّر، أو مدينةٌ
 *   لحقت بعد الإطلاق.
 * الحالة: منفّذ فعلياً — المرحلة 01، وعُدّل في 2026-08-14.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: مشغّلُ التشغيل على قاعدة الإنتاج.
 * ملاحظات مستقبلية: المعرّفات ليست أسراراً، لكنها قيم تشغيلية تبقى في cities ولا تُنسخ إلى البيئة.
 *
 * **إطلاقُ المدنِ الخمسِ معاً ليس عملَ هذا السكربت**: القسمُ ٣ من أمر الإطلاق
 * يفتحها في وقتٍ واحد، وذلك في `scripts/activate-launch-cities.ts` الذي يرفض
 * التفعيلَ الجزئيّ. وهذا الملفّ كان — إلى 2026-08-14 — **يُعطّل كلَّ مدينةٍ أخرى
 * مفعّلة** عند تفعيلِ مدينته، لأنّه كُتب لمرحلةٍ كانت المدينةُ الواحدةُ فيها هي
 * المنتَج. فذاك السطرُ حُذف: تشغيلُه اليومَ على مدينةٍ واحدةٍ كان سيُطفئ الأربعَ
 * الأخرياتِ صامتاً، وهو أسوأُ من خطأٍ يظهر لأنّه يُقرأ نجاحاً.
 */

import { createSql } from "../packages/infrastructure/db/client.ts";

const MIN_BIGINT = -(2n ** 63n);
const MAX_BIGINT = 2n ** 63n - 1n;

interface ActivationArgs {
  readonly cityCode: string;
  readonly supportGroupId: string;
  readonly escalationGroupId: string;
  readonly unsubscribedDriversGroupId: string;
}

function usage(message: string): never {
  throw new Error(
    `${message}\n` +
      "الاستخدام: bun scripts/activate-pilot-city.ts --city <CODE> " +
      "--support-group-id <ID> --escalation-group-id <ID> " +
      "--unsubscribed-drivers-group-id <ID>",
  );
}

function readArgs(argv: readonly string[]): ActivationArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      usage("المعاملات ناقصة أو مكتوبة بصيغة غير صحيحة.");
    }
    if (values.has(key)) usage(`المعامل ${key} مكرّر.`);
    values.set(key, value);
  }

  const allowed = new Set([
    "--city",
    "--support-group-id",
    "--escalation-group-id",
    "--unsubscribed-drivers-group-id",
  ]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) usage(`معامل غير معروف: ${key}`);
  }

  const cityCode = values.get("--city");
  const supportGroupId = values.get("--support-group-id");
  const escalationGroupId = values.get("--escalation-group-id");
  const unsubscribedDriversGroupId = values.get("--unsubscribed-drivers-group-id");
  if (
    cityCode === undefined ||
    supportGroupId === undefined ||
    escalationGroupId === undefined ||
    unsubscribedDriversGroupId === undefined
  ) {
    usage("يرفض السكربت التفعيل الجزئي: القروبات الثلاثة ومعرّف المدينة إلزامية.");
  }
  if (!/^[A-Z][A-Z0-9_]{1,15}$/.test(cityCode)) {
    usage("رمز المدينة يجب أن يكون أحرفاً وأرقاماً إنجليزية كبيرة.");
  }
  return { cityCode, supportGroupId, escalationGroupId, unsubscribedDriversGroupId };
}

function validateGroupId(value: string, label: string): bigint {
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`${label} يجب أن يكون عدداً صحيحاً بصيغة تيليجرام، والسالب مقبول للقروبات.`);
  }
  const parsed = BigInt(value);
  if (parsed === 0n || parsed < MIN_BIGINT || parsed > MAX_BIGINT) {
    throw new Error(`${label} خارج نطاق bigint الصالح أو يساوي صفراً.`);
  }
  return parsed;
}

async function activate(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const supportGroupId = validateGroupId(args.supportGroupId, "معرّف قروب الدعم");
  const escalationGroupId = validateGroupId(args.escalationGroupId, "معرّف قروب التصعيد");
  const unsubscribedDriversGroupId = validateGroupId(
    args.unsubscribedDriversGroupId,
    "معرّف قروب السائقين غير المشتركين",
  );
  if (
    new Set([
      supportGroupId.toString(),
      escalationGroupId.toString(),
      unsubscribedDriversGroupId.toString(),
    ]).size !== 3
  ) {
    throw new Error("القروبات الثلاثة يجب أن تحمل معرّفات مختلفة.");
  }

  const connectionString = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (connectionString === undefined || connectionString.trim() === "") {
    throw new Error("DATABASE_URL مطلوب للاتصال بقاعدة التشغيل.");
  }

  const sql = createSql({ connectionString });
  try {
    const result = await sql.begin(async (tx) => {
      const cities = await tx<{ id: string; code: string; name_ar: string; is_active: boolean }[]>`
        select id, code, name_ar, is_active
          from cities
         where code = ${args.cityCode}
         for update
      `;
      const city = cities[0];
      if (city === undefined) throw new Error(`لا توجد مدينة مزروعة بالرمز ${args.cityCode}.`);

      const activated = await tx<
        {
          code: string;
          name_ar: string;
          is_active: boolean;
          telegram_support_group_id: string;
          telegram_escalation_group_id: string;
          telegram_unsubscribed_drivers_group_id: string;
        }[]
      >`
        update cities
           set telegram_support_group_id = ${supportGroupId.toString()}::bigint,
               telegram_escalation_group_id = ${escalationGroupId.toString()}::bigint,
               telegram_unsubscribed_drivers_group_id = ${unsubscribedDriversGroupId.toString()}::bigint,
               is_active = true
         where id = ${city.id}::uuid
        returning code, name_ar, is_active,
                  telegram_support_group_id::text,
                  telegram_escalation_group_id::text,
                  telegram_unsubscribed_drivers_group_id::text
      `;
      const record = activated[0];
      if (record === undefined || !record.is_active) {
        throw new Error("فشل التفعيل الذرّي للمدينة المختارة.");
      }
      const others = await tx<{ code: string }[]>`
        select code from cities where id <> ${city.id}::uuid and is_active = true order by code
      `;
      return { record, others: others.map((row) => row.code) };
    });

    console.log(`تم تفعيل ${result.record.name_ar} (${result.record.code}).`);
    console.log(
      `القروبات: دعم=${result.record.telegram_support_group_id}، ` +
        `تصعيد=${result.record.telegram_escalation_group_id}، ` +
        `غير مشتركين=${result.record.telegram_unsubscribed_drivers_group_id}.`,
    );
    // المدنُ الأخرى تُذكَر ولا تُمَسّ: الإطلاقُ خمسُ مدنٍ معاً، وإطفاءُ إحداها
    // أثراً جانبياً لتفعيلِ أخرى هو ما كان يفعله هذا السكربت قبل التعديل.
    console.log(
      result.others.length === 0
        ? "لا مدينةَ مفعّلةً أخرى — إن كان هذا إطلاقاً فاستعمل scripts/activate-launch-cities.ts."
        : `مدنٌ مفعّلةٌ أخرى بقيت كما هي: ${result.others.join(", ")}.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

activate().catch((error: unknown) => {
  console.error(error instanceof Error ? `فشل تفعيل مدينة الـPilot: ${error.message}` : error);
  process.exitCode = 1;
});
