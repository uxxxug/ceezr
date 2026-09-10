/**
 * الغرض: **المُصدِرُ الوحيدُ لسطرِ سجلٍّ في المشروعِ كلِّه** — شكلُ السطرِ يُقرَّرُ
 *    ههنا لا في كلِّ تطبيقٍ على حدةٍ (`F8-03` · ADR 0078)، وأسماءُ الحقولِ
 *    الشخصيّةِ تُحجَبُ قبلَ الكتابةِ، والمُعرِّفُ الذي يُحتاجُ للربطِ التشغيليِّ
 *    يُستعاضُ عنه بكنيةٍ لا تُردُّ إلى أصلِها من السجلِّ.
 * الحالة: منفّذ فعلياً — طبقةُ المراقبةِ التشغيليةِ.
 * ينتمي إلى: packages/infrastructure/observability
 * يُستخدم من: apps/gateway · apps/workers · apps/admin (وكلُّ ما يُحقَنُ فيه `log`)
 * الحاكم: ADR 0078 · البند `F8-03` · القاعدة 0.6 (لا تخفيفَ للبوّابةِ)
 * ملاحظات مستقبلية: تصنيفُ الشدّةِ لكلِّ سطرٍ (`level` لكلِّ حدثٍ) و«١٤ مقياساً»
 *    و«لوحاتٌ وتنبيهاتٌ» بنودٌ أخرى (`F8-02` · `F8-07`) — **لا تُدَّعى ههنا**،
 *    و`level` يبقى **غائباً** حيثُ لا يُعرَفُ لا مكتوباً `info` كذباً.
 *
 * لماذا مُصدِرٌ واحدٌ لا دالّةٌ في كلِّ تطبيقٍ: قبلَ هذا الملفِّ كانت في المستودعِ
 * **أربعُ** دالّاتِ تسجيلٍ مستقلّةٍ بثلاثةِ أشكالٍ متنافرةٍ — سطرُ البوابةِ فيه
 * `at` بلا `level`، وسطرُ العاملِ فيه `level` **بلا `at`**، ومسارُ الإقلاعِ نصٌّ
 * حرٌّ على `console.error` بلا JSON ألبتّةَ. فمن أراد أن يرتّبَ أحداثَ عطبٍ
 * بينَ الخدمتَينِ لم يجدْ زمناً في نصفِ الأسطرِ، ومن أرادَ تصفيةَ الأخطاءِ لم
 * يجدْ شدّةً في نصفِها الآخرِ. والشكلُ لا يُوحَّدُ باتّفاقٍ بل بموضعٍ واحدٍ
 * يستحيلُ الكتابةُ إلّا منه — وحاجزُ `scripts/check-structured-logging.ts`
 * يمنعُ `console` في كلِّ ما عدا هذا الملفَّ.
 *
 * ولماذا تُحجَبُ الأسماءُ لا القيمُ: القيمُ لا تُعرَفُ وقتَ الكتابةِ، والاسمُ
 * يُعرَفُ. فحقلٌ اسمُه `phone` يُحجَبُ وإن كان فارغاً، والحجبُ يُعلَنُ في السطرِ
 * نفسِه (`redacted`) فلا يُخفى أنَّ شيئاً حُجِبَ.
 */

import { createHash, randomUUID } from "node:crypto";

/** حدُّ العمقِ في تنقيةِ الحقولِ. أعمقُ منه يُستبدَلُ بعلامةٍ لا يُقصُّ صامتاً. */
export const MAX_FIELD_DEPTH = 4;

/** حدُّ عددِ عناصرِ المصفوفةِ المنقولةِ. الزائدُ يُعلَنُ عدداً لا يُحذَفُ صامتاً. */
export const MAX_ARRAY_ITEMS = 20;

/** ما يُكتَبُ بدلَ قيمةِ حقلٍ شخصيٍّ. */
export const REDACTED = "[محجوب]";

/** ما يُكتَبُ بدلَ ما تجاوزَ حدَّ العمقِ. */
export const TRUNCATED = "[عميق]";

/** شكلُ رمزِ الحدثِ: لاتينيٌّ صغيرٌ منقوطٌ، بلا مسافةٍ ولا حرفٍ غيرِ لاتينيٍّ. */
export const EVENT_CODE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/** الشدّاتُ المعروفةُ. و`level` **اختياريٌّ**: غيابُه أصدقُ من `info` كذباً. */
export const LOG_LEVELS = ["info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Record<string, unknown>;

/**
 * أسماءُ الحقولِ الشخصيّةِ — **قائمةٌ مغلقةٌ تُطابَقُ اسماً كاملاً** بلا حساسيةِ
 * حالةٍ ولا فرقٍ بينَ `camelCase` و`snake_case`.
 *
 * والمطابقةُ باسمٍ كاملٍ لا بجزءٍ منه عن قصدٍ: `fileName` و`jobName` و`botName`
 * أسماءُ حقولٍ تشغيليّةٍ مشروعةٍ في السجلِّ، ومنعُ كلِّ ما فيه `name` كان
 * سيُسقِطَ البناءَ على حقولٍ لا بيانَ شخصيّاً فيها فيُدفَعُ الكاتبُ إلى تعطيلِ
 * الحاجزِ — وحاجزٌ يُنذِرُ باطلاً حاجزٌ يُلتمَسُ لَهُ مخرجٌ.
 */
export const PERSONAL_FIELD_NAMES: readonly string[] = [
  // شبكةٌ: عنوانُ العميلِ بيانٌ شخصيٌّ في نظامِ حمايةِ البياناتِ.
  "address",
  "clientAddress",
  "ip",
  "ipAddress",
  "remoteAddress",
  "forwardedFor",
  "userAgent",
  // هويّةٌ: مُعرِّفُ تلغرام يُردُّ إلى شخصٍ بعينِه.
  "actorId",
  "telegramId",
  "telegramUserId",
  "chatId",
  "username",
  // تواصلٌ وهويّةٌ رسميّةٌ.
  "phone",
  "phoneNumber",
  "email",
  "fullName",
  "firstName",
  "lastName",
  "displayName",
  "nationalId",
  "iqamaNumber",
  "licenseNumber",
  "plateNumber",
  // موضعٌ: إحداثيّاتُ شخصٍ بعينِه في لحظةٍ بعينِها.
  "lat",
  "lng",
  "latitude",
  "longitude",
  "pickupLat",
  "pickupLng",
  "dropoffLat",
  "dropoffLng",
  "coordinates",
];

const NORMALISED_PERSONAL_NAMES = new Set(
  PERSONAL_FIELD_NAMES.map((name) => name.toLowerCase().replaceAll("_", "")),
);

/**
 * هل هذا الاسمُ اسمُ حقلٍ شخصيٍّ؟ `phone_number` و`phoneNumber` و`PHONENUMBER`
 * سواءٌ — فالحيلةُ بتغييرِ الحالةِ أو بالشُّرطةِ السفليّةِ لا تمرُّ.
 */
export function isPersonalFieldName(name: string): boolean {
  return NORMALISED_PERSONAL_NAMES.has(name.toLowerCase().replaceAll("_", ""));
}

/**
 * كنيةٌ من مِلحٍ: `sha256(salt + ":" + value)` مقتطعةً إلى اثنَي عشرَ رقماً
 * ستّةَ عشريّاً.
 *
 * **ولماذا مِلحٌ لا تهشيمٌ مجرَّدٌ**: فضاءُ عناوينِ IPv4 اثنانِ وثلاثونَ بتّاً،
 * وفضاءُ مُعرِّفاتِ تلغرام أصغرُ منه — فتهشيمٌ بلا مِلحٍ يُردُّ إلى أصلِه
 * بالتجربةِ الشاملةِ في دقائقَ على حاسبٍ عاديٍّ. فالتهشيمُ المجرَّدُ **ضمانٌ
 * كاذبٌ**، ولا يُكتَبُ في هذا المشروعِ ضمانٌ كاذبٌ.
 */
export function pseudonym(value: string | number, salt: string): string {
  return createHash("sha256")
    .update(`${salt}:${String(value)}`)
    .digest("hex")
    .slice(0, 12);
}

/**
 * مِلحُ هذه العمليةِ. يُولَدُ مرّةً عندَ تحميلِ الوحدةِ، فكلُّ كنيةٍ في العمليةِ
 * — من المُسجِّلِ أو من `pseudonymise` مباشرةً — تتّفقُ على قيمةٍ واحدةٍ.
 */
const PROCESS_SALT = randomUUID();

/**
 * كنيةُ قيمةٍ بمِلحِ العمليةِ — للمواضعِ التي تُحقَنُ فيها دالّةُ تسجيلٍ مجرّدةٌ
 * `(event, fields) => void` فلا تملكُ `log.pseudonym`.
 *
 * ويُستعمَلُ حيثُ **يُحتاجُ الربطُ** فعلاً: عدُّ محاولاتِ عنوانٍ واحدٍ، وتتبُّعُ
 * أسطرِ مستخدمٍ واحدٍ في عطبٍ. ومن لا يحتاجُ الربطَ فلا يُمرِّرِ المُعرِّفَ أصلاً.
 */
export function pseudonymise(value: string | number): string {
  return pseudonym(value, PROCESS_SALT);
}

/**
 * سطرُ سجلٍّ كما يُكتَبُ. `at` و`service` و`event` **لا تغيبُ أبداً**، و`level`
 * يغيبُ حيثُ لا يُعرَفُ.
 */
export interface StructuredLogLine {
  readonly at: string;
  readonly service: string;
  readonly event: string;
  readonly level?: LogLevel;
  readonly [field: string]: unknown;
}

export interface StructuredLogger {
  /** يكتبُ سطراً بلا تصنيفِ شدّةٍ — وهو حالُ أغلبِ مواضعِ البوابةِ اليومَ. */
  (event: string, fields?: LogFields): void;
  readonly info: (event: string, fields?: LogFields) => void;
  readonly warn: (event: string, fields?: LogFields) => void;
  readonly error: (event: string, fields?: LogFields) => void;
  /** كنيةٌ ثابتةٌ داخلَ هذه العمليةِ لقيمةٍ واحدةٍ. */
  readonly pseudonym: (value: string | number) => string;
}

export interface StructuredLoggerOptions {
  /** اسمُ الخدمةِ الكاتبةِ: `gateway` · `worker` · `admin`. */
  readonly service: string;
  /** مَصرِفُ الكتابةِ. غيابُه ⇦ `console` (وهذا الملفُّ وحدَه يملكُ أن ينادِيَه). */
  readonly sink?: (line: string, level: LogLevel | undefined) => void;
  /** ساعةٌ للاختبارِ. غيابُها ⇦ ساعةُ النظامِ. */
  readonly now?: () => Date;
  /**
   * مِلحُ الكنيةِ. غيابُه ⇦ مِلحٌ عشوائيٌّ **لكلِّ عمليةٍ**.
   *
   * وأثرُ ذلكَ مُعلَنٌ لا مسكوتٌ عنه: الكنيةُ تربطُ أسطرَ العمليةِ الواحدةِ في
   * عمرِها، **ولا تربطُ بينَ مثيلَينِ ولا بعدَ إعادةِ تشغيلٍ**. وهذا هوَ ما
   * تحتاجُه حدودُ المعدّلِ فعلاً؛ ومن أرادَ ربطاً أوسعَ فليُمرِّرْ مِلحاً
   * مشتركاً — قرارُ نشرٍ لا افتراضٌ صامتٌ.
   */
  readonly salt?: string;
}

/**
 * تنقيةُ قيمةٍ: حجبُ ما اسمُه شخصيٌّ، وتسويةُ ما لا يُسلسَلُ، وقصُّ العميقِ
 * بعلامةٍ مُعلَنةٍ.
 */
function sanitiseValue(value: unknown, depth: number, redacted: string[]): unknown {
  if (depth > MAX_FIELD_DEPTH) return TRUNCATED;
  if (value === null) return null;
  if (value instanceof Error) return { message: value.message, name: value.name };
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitiseValue(item, depth + 1, redacted));
    return value.length > MAX_ARRAY_ITEMS
      ? [...items, `[+${value.length - MAX_ARRAY_ITEMS}]`]
      : items;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      if (isPersonalFieldName(key)) {
        out[key] = REDACTED;
        redacted.push(key);
        continue;
      }
      out[key] = sanitiseValue(item, depth + 1, redacted);
    }
    return out;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  return value;
}

/** تنقيةُ حقولِ السطرِ. تُعيدُ الحقولَ وقائمةَ ما حُجِبَ. */
export function sanitiseFields(fields: LogFields): {
  readonly fields: LogFields;
  readonly redacted: readonly string[];
} {
  const redacted: string[] = [];
  const sanitised = sanitiseValue(fields, 0, redacted) as LogFields;
  return { fields: sanitised, redacted };
}

/**
 * تسلسلٌ لا يرمي أبداً: قيمةٌ لا تُسلسَلُ لا يجوزُ أن تُسقِطَ المسارَ الذي يُسجِّلُ
 * — فالسجلُّ يُكتَبُ في مسارِ خطأٍ أصلاً، وإسقاطُه ثانيةً يُفقِدُ السببَ الأوّلَ.
 *
 * **وما لا يُدَّعى**: هذا الفرعُ حرزٌ **غيرُ مقيسٍ**. فالتنقيةُ قبلَه تُسوِّي
 * الأنواعَ وتقطعُ الدورةَ بحدِّ العمقِ، فلا يُعرَفُ اليومَ مُدخَلٌ يبلغُه. ويبقى
 * لأنّ ستّةَ أسطرٍ أرخصُ من رميةٍ غيرِ مُلتقَطةٍ في مسارِ عطبٍ (`ح-5`).
 */
function safeStringify(line: StructuredLogLine): string {
  try {
    return JSON.stringify(line);
  } catch {
    return JSON.stringify({
      at: line.at,
      service: line.service,
      event: "log.serialisation_failed",
      requested_event: line.event,
    });
  }
}

/**
 * يُنشئُ المُسجِّلَ. والنداءُ المباشرُ (`log(event, fields)`) يبقى بالتوقيعِ
 * الذي كانَ في المستودعِ قبلَ اليومِ — فلا يُعادُ كتابةُ مائتَي موضعٍ ولا عشرينَ
 * عقدَ حقنٍ لأجلِ شكلِ سطرٍ.
 */
export function createStructuredLogger(options: StructuredLoggerOptions): StructuredLogger {
  const now = options.now ?? (() => new Date());
  const salt = options.salt ?? PROCESS_SALT;
  const sink =
    options.sink ??
    ((line: string, level: LogLevel | undefined) => {
      // الموضعُ الوحيدُ في المشروعِ الذي يملكُ أن ينادِيَ `console` — يحرسُه
      // `scripts/check-structured-logging.ts`، ونقلُه إلى غيرِه يُسقِطُ البناءَ.
      if (level === "error") console.error(line);
      else console.log(line);
    });

  function emit(event: string, fields: LogFields | undefined, level: LogLevel | undefined): void {
    const at = now().toISOString();

    // رمزٌ غيرُ مطابقٍ للشكلِ **لا يُكتَبُ نصّاً**: قد يكونُ نصّاً حرّاً فيه اسمٌ
    // أو رقمٌ أو عنوانٌ، وكتابتُه في حقلٍ آخرَ تنقلُ العطبَ لا تُصلِحُه. فيُعلَنُ
    // بصوتٍ: حدثٌ مجهولٌ بطولِه لا بنصِّه.
    if (!EVENT_CODE_PATTERN.test(event)) {
      const line: StructuredLogLine = {
        at,
        service: options.service,
        event: "log.invalid_event_code",
        level: "error",
        requested_length: event.length,
      };
      sink(safeStringify(line), "error");
      return;
    }

    const sanitised = sanitiseFields(fields ?? {});
    const line: StructuredLogLine = {
      at,
      service: options.service,
      event,
      ...(level === undefined ? {} : { level }),
      ...sanitised.fields,
      ...(sanitised.redacted.length === 0 ? {} : { redacted: sanitised.redacted }),
    };
    sink(safeStringify(line), level);
  }

  const logger = ((event: string, fields?: LogFields) => {
    emit(event, fields, undefined);
  }) as {
    (event: string, fields?: LogFields): void;
    info: (event: string, fields?: LogFields) => void;
    warn: (event: string, fields?: LogFields) => void;
    error: (event: string, fields?: LogFields) => void;
    pseudonym: (value: string | number) => string;
  };

  logger.info = (event, fields) => emit(event, fields, "info");
  logger.warn = (event, fields) => emit(event, fields, "warn");
  logger.error = (event, fields) => emit(event, fields, "error");
  logger.pseudonym = (value) => pseudonym(value, salt);

  return logger;
}
