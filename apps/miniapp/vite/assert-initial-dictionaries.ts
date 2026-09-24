/**
 * # حاجزُ الحِملِ الأوّلِ: لا قاموسَ غيرَ افتراضيٍّ — `F1-09` · `D-29` · `ADR 0186`
 *
 * **الغرض:** يُسقِطُ البناءَ إن دخلَ قاموسُ `en` أو `ur` (أو المدخلُ `i18n/miniapp/index.ts` الذي
 * يستوردُهما ثابتاً) أيَّ حزمةٍ في الحِملِ الأوّلِ — المدخلِ وما يستوردُه ثابتاً بالتعدّي. والسببُ
 * مَقيسٌ: كانَت القواميسُ الثلاثةُ في `shell` (≈ 52.7 KB مضغوطةً للغتَينِ لا تُعرَضانِ) على
 * المسارِ الحرجِ. والحاجزُ على **الرسمِ البيانيِّ للحزمِ** لا على المصدرِ: استيرادٌ ثابتٌ واحدٌ
 * من أيِّ ملفٍّ يُعيدُهما، وهذا ما يُلتقَطُ.
 *
 * **الحالة:** مُنفَّذ · مُختبَر (`tests/unit/assert-initial-dictionaries.test.ts`).
 * **ما لا يفعله:** لا يقيسُ زمناً — القياسُ في وظيفةِ Slow 4G.
 */

import type { Plugin } from "vite";

/** وحدةٌ ممنوعةٌ في الحِملِ الأوّلِ. */
const DEFERRED_DICTIONARY = /[\\/]i18n[\\/]miniapp[\\/](?:en\.json|ur\.json|index\.ts)$/;

export interface ChunkGraphNode {
  readonly fileName: string;
  readonly isEntry: boolean;
  readonly imports: readonly string[];
  readonly moduleIds: readonly string[];
}

/** مخالفاتُ الحِملِ الأوّلِ؛ قائمةٌ فارغةٌ = سليمٌ. نقيّةٌ لتُختبَر. */
export function initialDictionaryViolations(chunks: readonly ChunkGraphNode[]): string[] {
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const initial = new Set<string>();
  const queue = chunks.filter((c) => c.isEntry).map((c) => c.fileName);
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (initial.has(name)) continue;
    initial.add(name);
    for (const next of byName.get(name)?.imports ?? []) queue.push(next);
  }
  const violations: string[] = [];
  for (const name of initial) {
    for (const id of byName.get(name)?.moduleIds ?? []) {
      if (DEFERRED_DICTIONARY.test(id))
        violations.push(`${name} ← ${id.split(/[\\/]/).slice(-3).join("/")}`);
    }
  }
  return violations;
}

export function assertInitialDictionaries(): Plugin {
  return {
    name: "waslah-assert-initial-dictionaries",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks: ChunkGraphNode[] = [];
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        chunks.push({
          fileName: item.fileName,
          isEntry: item.isEntry,
          imports: item.imports,
          moduleIds: item.moduleIds,
        });
      }
      const violations = initialDictionaryViolations(chunks);
      if (violations.length > 0) {
        this.error(
          `F1-09 · D-29: قاموسٌ غيرُ افتراضيٍّ في الحِملِ الأوّلِ (يُحمَّلُ عندَ الطلبِ من \`i18n/miniapp/load.ts\`):\n- ${violations.join("\n- ")}`,
        );
      }
    },
  };
}
