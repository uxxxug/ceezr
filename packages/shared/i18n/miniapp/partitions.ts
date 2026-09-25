/**
 * الغرض: قاعدةُ تقسيمِ القاموسِ العربيِّ على حزمِ التطبيقِ المصغَّرِ — **مصدرٌ واحدٌ** يقرؤه ملحقُ البناءِ وحاجزُه واختباراتُه.
 * الحالة: منفّذ فعلياً — `F1-09` · `D-33` · `ADR 0188`.
 * ينتمي إلى: shared/i18n/miniapp
 *
 * `ar.json` يبقى الملفَّ الوحيدَ للنصوصِ؛ وهذه القاعدةُ لا تنسخُ مفتاحاً: تنسبُ كلَّ مفتاحٍ إلى جزءٍ ببادئتِه. وما لا تطابقُه
 * بادئةٌ فهوَ `core` (يُحمَلُ في `shell`). وكلُّ جزءٍ غيرِ `core` تُسجِّلُه وحدةُ `ar-parts/<الجزء>.ts` التي تستوردُها
 * الوحداتُ المستعمِلةُ لمفاتيحِه، وحاجزُ `apps/miniapp/vite/assert-dictionary-partitions.ts` يُسقِطُ البناءَ إن استُعمِلَ مفتاحٌ
 * في حزمةٍ لا يَبلُغُ جزأَه ثابتاً.
 */

/** الأجزاءُ المؤجَّلةُ وبادئاتُها. الترتيبُ لا يهمُّ: لا بادئةَ تحتوي أخرى (يفرضُه الاختبارُ). */
export const ARABIC_DEFERRED_PARTITIONS = {
  driver: ["driver."],
  "rider-ride": ["rider.active.", "rider.share."],
  account: ["rider.account."],
  support: ["rider.support."],
  "rider-history": ["rider.history.", "rider.notifications."],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type ArabicDeferredPartition = keyof typeof ARABIC_DEFERRED_PARTITIONS;
export type ArabicPartition = "core" | ArabicDeferredPartition;

export const ARABIC_PARTITION_NAMES: readonly ArabicPartition[] = [
  "core",
  ...(Object.keys(ARABIC_DEFERRED_PARTITIONS) as ArabicDeferredPartition[]),
];

/** جزءُ مفتاحٍ كاملٍ. */
export function arabicPartitionOf(key: string): ArabicPartition {
  for (const [name, prefixes] of Object.entries(ARABIC_DEFERRED_PARTITIONS)) {
    if ((prefixes as readonly string[]).some((p) => key.startsWith(p)))
      return name as ArabicDeferredPartition;
  }
  return "core";
}

/**
 * جزءُ **حرفٍ ثابتٍ** في الشيفرةِ قد يكونُ مفتاحاً كاملاً أو بادئةً تُكمَّلُ وقتَ التشغيلِ (`\`rider.support.${x}\``).
 * يُعيدُ `"ambiguous"` لبادئةٍ أقصرَ من بادئةِ جزءٍ مؤجَّلٍ (`"rider."`): لا يُعرَفُ جزؤها فلا يُسكَتُ عنها.
 */
export function arabicPartitionOfLiteral(literal: string): ArabicPartition | "ambiguous" {
  const direct = arabicPartitionOf(literal);
  if (direct !== "core") return direct;
  for (const prefixes of Object.values(ARABIC_DEFERRED_PARTITIONS)) {
    if ((prefixes as readonly string[]).some((p) => p.startsWith(literal) && p !== literal))
      return "ambiguous";
  }
  return "core";
}

/** مفاتيحُ جزءٍ من القاموسِ كاملاً — يشتقُّها الملحقُ وقتَ البناءِ، ولا تُكتَبُ في ملفٍّ. */
export function pickArabicPartition(
  dictionary: Readonly<Record<string, string>>,
  partition: ArabicPartition,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const [key, value] of Object.entries(dictionary)) {
    if (arabicPartitionOf(key) === partition) picked[key] = value;
  }
  return picked;
}
