/**
 * # حاجزُ مراجعِ الأصولِ: لا حزمةَ تشيرُ إلى ملفٍّ ليسَ في المُخرَجِ — `F1-09` · `D-30`
 *
 * **الغرض:** بعدَ اكتمالِ المُخرَجِ (`writeBundle`، أي بعدَ أن يحذفَ `inline-stylesheet.ts` الأنماطَ المُدمَجةَ)
 * يقرأُ كلَّ حزمةٍ ويتحقّقُ أنَّ كلَّ مرجعٍ `assets/<ملف>` فيها موجودٌ في المُخرَجِ. والسببُ مَقيسٌ: لمّا صارَت
 * شاشاتُ الراكبِ حزماً مؤجَّلةً أدرجَ Vite «أنماطَ `shell`» (المُدمَجةَ والمحذوفةَ) في تبعيّاتِ `import()`،
 * فطلبَ المتصفّحُ ملفّاً غيرَ موجودٍ (CI `36070289143`: `net::ERR_ABORTED …/shell-*.css` في كلِّ تشغيلٍ)،
 * ومُحمِّلُ Vite يرفضُ الاستيرادَ حينَها فتسقطُ الشاشةُ. البناءُ كانَ أخضرَ؛ وهذا الحاجزُ يجعلُه أحمرَ.
 *
 * **الحالة:** مُنفَّذ · مُختبَر (`tests/unit/assert-asset-references.test.ts`).
 */

import type { Plugin } from "vite";

const ASSET_REFERENCE = /assets\/[A-Za-z0-9_.-]+\.(?:js|css|woff2?|png|svg|webp|json)/g;

/** المراجعُ المفقودةُ؛ قائمةٌ فارغةٌ = سليمٌ. نقيّةٌ لتُختبَر. */
export function missingAssetReferences(files: ReadonlyMap<string, string | null>): string[] {
  const missing: string[] = [];
  for (const [name, code] of files) {
    if (code === null) continue;
    for (const ref of new Set(code.match(ASSET_REFERENCE) ?? [])) {
      if (!files.has(ref)) missing.push(`${name} → ${ref}`);
    }
  }
  return missing;
}

export function assertAssetReferences(): Plugin {
  return {
    name: "waslah-assert-asset-references",
    apply: "build",
    writeBundle(_options, bundle) {
      const files = new Map<string, string | null>();
      for (const [name, item] of Object.entries(bundle)) {
        files.set(name, item.type === "chunk" ? item.code : null);
      }
      const missing = missingAssetReferences(files);
      if (missing.length > 0) {
        this.error(`F1-09 · D-30: حزمةٌ تشيرُ إلى أصلٍ ليسَ في المُخرَجِ:\n- ${missing.join("\n- ")}`);
      }
    },
  };
}
