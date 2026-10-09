/**
 * # حاجزُ سطحِ الراكبِ الأوّلِ: حزمُ القسمِ 9.4 المؤجَّلةُ لا تدخلُه — `F1-09` · `D-30`
 *
 * **الغرض:** مصدرٌ واحدٌ لتعريفِ وحداتِ `rider-ride` و`support`/`account` للراكبِ (يقرؤه `vite.config.ts` لتسميةِ
 * الحزمِ، ويقرؤه هذا الحاجزُ)، وحاجزُ بناءٍ يتتبّعُ الاستيرادَ **الثابتَ** بالتعدّي من الحزمةِ التي فيها
 * `surfaces/rider/RiderRoot.tsx` ويُسقِطُ البناءَ إن بلغَ وحدةً مؤجَّلةً. والسببُ مَقيسٌ: كانَت `rider-home`
 * (40,184 B) تحملُ كلَّ شاشاتِ الراكبِ وقناةَ `socket.io`، فتُنزَّلُ قبلَ أوّلِ سطحٍ لا يحتاجُ شيئاً منها
 * (CI `36068849297`: 1,885→2,670 ms). والحاجزُ على الرسمِ البيانيِّ للحزمِ لا على المصدرِ: استيرادٌ ثابتٌ واحدٌ
 * أو ترتيبُ مجموعاتٍ خاطئٌ (المجموعةُ تسحبُ تبعيّاتِها) يُعيدُها، وهذا ما يُلتقَطُ.
 *
 * **الحالة:** مُنفَّذ · مُختبَر (`tests/unit/assert-rider-first-surface.test.ts`).
 * **ما لا يفعله:** لا يقيسُ زمناً — القياسُ في وظيفةِ Slow 4G.
 */

import type { Plugin } from "vite";
import type { ChunkGraphNode } from "./assert-initial-dictionaries.ts";

/**
 * `rider-ride`: البحثُ والرحلةُ النشطةُ والملخّصُ والمشاركةُ وقناتُها الحيّةُ ومكتباتُها. ومساعداتُ العرضِ النقيّةُ
 * (`search-view` · `ride-summary-view`) مستثناةٌ عن قصدٍ: يستوردُها السطحُ الأوّلُ والسائقُ، ووضعُها هنا يجعلُ
 * مستورِدَها يستوردُ الحزمةَ كلَّها ثابتاً.
 */
export const RIDER_RIDE =
  /\/src\/surfaces\/rider\/(?:rider-ride-screens\.ts|search\/(?!search-view)|active\/|summary\/(?!ride-summary-view)|share\/)|\/src\/services\/(?:production-ride-channel|ride-channel-client|live-tracking-reducer)|[\\/]node_modules[\\/](?:socket\.io-client|socket\.io-parser|engine\.io-client|engine\.io-parser|@socket\.io)[\\/]/;

/**
 * شاشتا الدعمِ والحسابِ للراكبِ وأساسُهما المشتركُ — حزمتا `support` و`account` عندَ الطلبِ.
 * ولوحاتُ [B] (`rider/settings/` · UI-3 / PR 5 · ADR 0238) مؤجَّلةٌ معَها: لا يستوردُها غيرُ الحسابِ والدعمِ
 * والإشعارات. وقبلَ استثنائِها طابقَها نمطُ `rider-home` فدخلَت المسارَ الحرجَ (+11.6 KB مضغوطة) وسقطَ
 * قياسُ Slow 4G (`surface-rendered` 2068 ms > 2000 ms) — فالاستثناءُ إصلاحٌ لا تجميل.
 * و`faq/` و`privacy/` (`LOC-TRUST-01`): محمَّلتانِ بطلبٍ في `RiderRoot` منذُ `D-30`، لكنَّ نمطَ `rider-home` طابقَهما
 * فبقيتا في المسارِ الحرجِ ومعَهما قاموسُ `support` الذي تستوردُه الأسئلةُ (~9 KB خام). ظهرَ حينَ زادَت شاشتا
 * الوجهةِ والاقتباسِ ~3 KB مضغوطة فسقطَ Slow 4G على `main` (`surface-rendered` 2028 ms).
 */
const RIDER_ON_DEMAND =
  /\/src\/surfaces\/(?:rider\/)?(?:support|account)\/|\/src\/surfaces\/rider\/(?:settings|faq|privacy)\//;

/**
 * `D-32` · `rider-history`: السجلُّ وتفاصيلُه والإشعاراتُ بطلبِ الراكبِ وحدَه. ووحدةُ `ride-history-view` النقيّةُ ليسَت
 * مستثناةً هنا: لا يستوردُها غيرُ شاشاتِ السجلِّ (مَقيسٌ: `rg "history/" src/surfaces`).
 */
export const RIDER_HISTORY =
  /\/src\/surfaces\/rider\/(?:rider-history-screens\.ts|history\/|notifications\/)/;

/** ADR 0251: شاشةُ التسعيرِ وعقدُها — مؤجَّلةٌ بعدَ رسمِ السطحِ الأوّل. */
export const RIDER_QUOTE = /\/src\/surfaces\/rider\/quote\//;

/**
 * ADR 0251: مساعدا العرضِ النقيّانِ `search-view` و`ride-summary-view` بقيا في `rider-home` لأنَّ الاقتباسَ
 * (السطحَ الأوّلَ يومَها) يستوردُ `search-view`. بعدَ تأجيلِ الاقتباسِ لا يستوردُهما من السطحِ الأوّلِ أحدٌ
 * (مستورِدوهما: الاقتباسُ والبحثُ والرحلةُ النشطةُ والملخّصُ والحسابُ وملخّصُ السائق)، فصارا حزمةَ `rider-views`
 * المؤجَّلةَ — مستقلّةً عن `rider-ride` كي لا يستوردَ الحسابُ والسائقُ قناةَ الرحلةِ الحيّةَ ثابتاً.
 */
export const RIDER_SHARED_VIEWS =
  /\/src\/surfaces\/rider\/(?:search\/search-view|summary\/ride-summary-view)\.ts$/;

/**
 * ADR 0251 · `D-41`: شاشةُ الوجهةِ (`SR-03`) ووحداتُها — مؤجَّلةٌ بعدَ رسمِ السطحِ الأوّل. صفُّ `rider-home` الأصليُّ في 9.4
 * لا يذكرُها، والرئيسيّةُ لا تستوردُ منها إلّا أنواعاً (`rider-flow.ts` · `ConfirmedDestination`).
 */
export const RIDER_DESTINATION = /\/src\/surfaces\/rider\/destination\//;

export function isDeferredRiderModule(id: string): boolean {
  return (
    RIDER_DESTINATION.test(id) ||
    RIDER_RIDE.test(id) ||
    RIDER_ON_DEMAND.test(id) ||
    RIDER_HISTORY.test(id) ||
    RIDER_QUOTE.test(id) ||
    RIDER_SHARED_VIEWS.test(id)
  );
}

const RIDER_ROOT = /\/src\/surfaces\/rider\/RiderRoot\.tsx$/;

/** مخالفاتُ حِملِ سطحِ الراكبِ الأوّلِ؛ قائمةٌ فارغةٌ = سليمٌ. نقيّةٌ لتُختبَر. */
export function riderFirstSurfaceViolations(chunks: readonly ChunkGraphNode[]): string[] {
  const root = chunks.find((c) => c.moduleIds.some((id) => RIDER_ROOT.test(id)));
  if (root === undefined)
    return ["لا حزمةَ تحملُ `surfaces/rider/RiderRoot.tsx` — الحاجزُ لا يُعمى صامتاً"];
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const reached = new Set<string>();
  const queue = [root.fileName];
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (reached.has(name)) continue;
    reached.add(name);
    for (const next of byName.get(name)?.imports ?? []) queue.push(next);
  }
  const violations: string[] = [];
  for (const name of reached) {
    for (const id of byName.get(name)?.moduleIds ?? []) {
      if (isDeferredRiderModule(id)) {
        violations.push(`${name} ← ${id.split(/[\\/]/).slice(-3).join("/")}`);
      }
    }
  }
  return violations;
}

export function assertRiderFirstSurface(): Plugin {
  return {
    name: "waslah-assert-rider-first-surface",
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
      const violations = riderFirstSurfaceViolations(chunks);
      if (violations.length > 0) {
        this.error(
          `F1-09 · D-30: وحدةٌ من حزمِ القسمِ 9.4 المؤجَّلةِ في حِملِ سطحِ الراكبِ الأوّلِ:\n- ${violations.slice(0, 20).join("\n- ")}`,
        );
      }
    },
  };
}
