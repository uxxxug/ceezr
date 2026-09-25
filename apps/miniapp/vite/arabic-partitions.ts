/**
 * الغرض: ملحقُ بناءٍ يُحلِّلُ استيرادَ `ar.json` بحسبِ مستورِدِه إلى جزءٍ مشتقٍّ من القاموسِ — `core` لـ`core.ts` وجزءُ
 *   `<اسم>` لـ`ar-parts/<اسم>.ts` — فلا يحملُ `shell` إلّا نصوصَ السطحِ الأوّلِ والإطارِ (`F1-09` · `D-33` · `ADR 0188`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/vite
 *
 * لا ينسخُ نصّاً: يقرأُ `ar.json` وقتَ البناءِ ويشتقُّ بقاعدةِ `partitions.ts` الوحيدة. وما لا يفعلُه: لا يمسُّ `en`/`ur`
 * (حزمٌ مؤجَّلةٌ كاملةٌ · `D-29`)، ولا يعملُ في Bun — هناك القاموسُ كاملٌ فالسلوكُ للخادمِ والاختباراتِ لا يتغيّرُ.
 */

import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import {
  ARABIC_PARTITION_NAMES,
  type ArabicPartition,
  pickArabicPartition,
} from "../../../packages/shared/i18n/miniapp/partitions.ts";

export const ARABIC_PART_PREFIX = "\0waslah-ar-part:";

const IMPORTER = /[\\/]i18n[\\/]miniapp[\\/](?:(core)\.ts|ar-parts[\\/]([a-z-]+)\.ts)$/;

/** جزءُ المستورِدِ أو `null` إن لم يكن من وحدتَي القاموسِ المعتمدتَينِ. */
export function partitionForImporter(
  source: string,
  importer: string | undefined,
): ArabicPartition | null {
  if (importer === undefined || !/(?:^|[\\/])ar\.json$/.test(source)) return null;
  const match = IMPORTER.exec(importer);
  if (match === null) return null;
  const name = (match[1] ?? match[2]) as string;
  if (!(ARABIC_PARTITION_NAMES as readonly string[]).includes(name)) {
    throw new Error(`D-33: \`ar-parts/${name}.ts\` بلا جزءٍ مُعلَنٍ في partitions.ts`);
  }
  return name as ArabicPartition;
}

export function arabicPartitions(dictionaryPath: string): Plugin {
  return {
    name: "waslah-arabic-partitions",
    apply: "build",
    enforce: "pre",
    resolveId(source, importer) {
      const partition = partitionForImporter(source, importer);
      return partition === null ? null : `${ARABIC_PART_PREFIX}${partition}`;
    },
    load(id) {
      if (!id.startsWith(ARABIC_PART_PREFIX)) return null;
      const partition = id.slice(ARABIC_PART_PREFIX.length) as ArabicPartition;
      const dictionary = JSON.parse(readFileSync(dictionaryPath, "utf8")) as Record<string, string>;
      return `export default ${JSON.stringify(pickArabicPartition(dictionary, partition))};`;
    },
  };
}
