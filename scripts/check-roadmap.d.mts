/**
 * تصريحُ نوعٍ لحاجزِ طزاجةِ الخارطةِ.
 *
 * **ولِمَ ملفُّ تصريحٍ ولا تحويلٌ إلى TypeScript؟** الحاجزُ يُشغَّلُ بـ`node` في
 * سيرِ عملٍ مستقلٍّ لا يملكُ Bun قبلَ خطوتِه، واسمُه مُقيَّدٌ في سيرِ العملِ وفي
 * سجلِّ تكافؤِ الإنفاذِ. **وتحويلُه لغةً تغييرٌ في سلسلةِ تشغيلِه** لا علاقةَ له
 * بالعطبِ المُصلَحِ (`OPS-ROADMAP-GATE`)، فيكونُ توسيعَ نطاقٍ. والتصريحُ هوَ
 * الوسيلةُ المُقرَّرةُ لأن تُختبَرَ وحدةُ JavaScript من TypeScript، **وليسَ
 * إسكاتاً**: النوعُ مكتوبٌ فيُحاكَمُ المُنادي به.
 */

/** الملفّاتُ التي يُجزئُ تحديثُ أحدِها. اثنانِ — والتكرارُ مُعلَنٌ في `ADR 0167`. */
export declare const ROADMAP_FILES: readonly string[];

/**
 * حلُّ المدى. يُرَدُّ **نصُّ سببٍ** عندَ تعذُّرِ الحلِّ لا مدىً صامتٌ، فالمُنادي
 * يسقُطُ ولا يقرأُ التعذُّرَ نجاحاً.
 */
export declare function resolveRange(
  argBase: string | undefined,
  argHead: string | undefined,
  env?: Record<string, string | undefined>,
): { readonly base: string; readonly head: string } | string;

/** الحكمُ النقيُّ: لا `git` ولا `process` فيه فيُختبَرُ مباشرةً. */
export declare function evaluateRoadmapFreshness(files: readonly string[]): {
  readonly implementation: readonly string[];
  readonly roadmap: readonly string[];
  readonly ok: boolean;
};
