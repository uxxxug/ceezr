/**
 * الغرض: حاجزُ بناءٍ لتقسيمِ القاموسِ العربيِّ (`F1-09` · `D-33` · `ADR 0188`): لا يُستعمَلُ مفتاحٌ في حزمةٍ لا تَبلُغُ
 *   وحدةَ تسجيلِ جزئِه ثابتاً (هيَ أو ما تستوردُه)، ولا يظهرُ `ar.json` كاملاً في المُخرَجِ، ولا حرفٌ ملتبسُ الجزءِ.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/vite
 *
 * يقرأُ الشيفرةَ المُصيَّرةَ لكلِّ وحدةٍ (بعدَ حذفِ الميّتِ) ويستخرجُ الحروفَ الثابتةَ التي تبدأُ بمقطعٍ أوّلَ لبادئةٍ مؤجَّلةٍ
 * (`"rider.…"` · `\`driver.…${`). فالمفتاحُ المركَّبُ وقتَ التشغيلِ يُنسَبُ ببادئتِه الثابتةِ، والأقصرُ من بادئةِ جزءٍ يُرفَضُ.
 */

import type { Plugin } from "vite";
import {
  ARABIC_DEFERRED_PARTITIONS,
  arabicPartitionOfLiteral,
} from "../../../packages/shared/i18n/miniapp/partitions.ts";
import { ARABIC_PART_PREFIX } from "./arabic-partitions.ts";

export interface PartitionChunk {
  readonly fileName: string;
  readonly imports: readonly string[];
  /** الوحداتُ وشيفرتُها المُصيَّرةُ (`null` لوحدةٍ حُذِفَت كلُّها). */
  readonly modules: Readonly<Record<string, string | null>>;
}

const FIRST_SEGMENTS = [
  ...new Set(
    Object.values(ARABIC_DEFERRED_PARTITIONS).flatMap((ps) => ps.map((p) => p.split(".")[0])),
  ),
];
const LITERAL = new RegExp(`["'\`]((?:${FIRST_SEGMENTS.join("|")})\\.[A-Za-z0-9_.]*)`, "g");
const REGISTRATION = /[\\/]i18n[\\/]miniapp[\\/]ar-parts[\\/]([a-z-]+)\.ts$/;
const FULL_DICTIONARY = /[\\/]i18n[\\/]miniapp[\\/]ar\.json$/;
/** وحداتٌ حروفُها بياناتٌ لا استعمالٌ: الأجزاءُ نفسُها وقاموسا `en`/`ur` المؤجَّلانِ (مفاتيحُهما خصائصُ لا مراجعُ). */
const DEFERRED_DICTIONARY = /[\\/]i18n[\\/]miniapp[\\/](?:en|ur)\.json$/;
const isPartitionData = (id: string) =>
  id.startsWith(ARABIC_PART_PREFIX) || DEFERRED_DICTIONARY.test(id);

const short = (id: string) => id.replace(/^\0/, "").split(/[\\/]/).slice(-3).join("/");

export function dictionaryPartitionViolations(chunks: readonly PartitionChunk[]): string[] {
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const violations: string[] = [];
  for (const chunk of chunks) {
    const reachable = new Set<string>();
    const queue = [chunk.fileName];
    while (queue.length > 0) {
      const name = queue.pop() as string;
      if (reachable.has(name)) continue;
      reachable.add(name);
      for (const next of byName.get(name)?.imports ?? []) queue.push(next);
    }
    const registered = new Set<string>();
    for (const name of reachable) {
      for (const id of Object.keys(byName.get(name)?.modules ?? {})) {
        const match = REGISTRATION.exec(id);
        if (match !== null) registered.add(match[1] as string);
      }
    }
    for (const [id, code] of Object.entries(chunk.modules)) {
      if (FULL_DICTIONARY.test(id)) {
        violations.push(`${chunk.fileName} ← ${short(id)} كاملاً (الملحقُ لم يُقسِّمْه)`);
        continue;
      }
      if (code === null || isPartitionData(id)) continue;
      for (const match of code.matchAll(LITERAL)) {
        const literal = match[1] as string;
        const partition = arabicPartitionOfLiteral(literal);
        if (partition === "core") continue;
        if (partition === "ambiguous") {
          violations.push(`${chunk.fileName} ← ${short(id)}: «${literal}» بادئةٌ لا يُعرَفُ جزؤها`);
        } else if (!registered.has(partition)) {
          violations.push(
            `${chunk.fileName} ← ${short(id)}: «${literal}» من جزءِ \`${partition}\` ولا تَبلُغُ الحزمةُ ar-parts/${partition}.ts ثابتاً`,
          );
        }
      }
    }
  }
  return [...new Set(violations)];
}

export function assertDictionaryPartitions(): Plugin {
  return {
    name: "waslah-assert-dictionary-partitions",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks: PartitionChunk[] = [];
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        const modules: Record<string, string | null> = {};
        for (const [id, info] of Object.entries(item.modules)) modules[id] = info.code;
        chunks.push({ fileName: item.fileName, imports: item.imports, modules });
      }
      const violations = dictionaryPartitionViolations(chunks);
      if (violations.length > 0) {
        this.error(`F1-09 · D-33: تقسيمُ القاموسِ العربيِّ مكسورٌ:\n- ${violations.join("\n- ")}`);
      }
    },
  };
}
