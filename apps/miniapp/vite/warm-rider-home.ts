/**
 * # تسخينُ حزمةِ `rider-home` بعدَ تبادلِ الجلسةِ — `F1-09` · `D-31` · `ADR 0187`
 *
 * **الغرض:** السكربتُ الساكنُ في `index.html` يطلبُ `rider-home` (`modulepreload`) حينَ ينجحُ تبادلُ الجلسةِ، بدلَ أن تنتظرَ
 * الحزمةُ ردَّ `GET /v1/me` ثمَّ تقييمَ `shell`. وهذه الإضافةُ تحقنُ اسمَها المبنيَّ مكانَ `WARM_PLACEHOLDER` **قبلَ** بصمةِ
 * `injectCsp`، وتُسقِطُ البناءَ إن:
 *   1. لم تجدِ العلامةَ في المستندِ (سُحِبَ التسخينُ بلا قرارٍ)؛
 *   2. لم تجدْ حزمةً تحوي `RiderRoot.tsx`؛
 *   3. لم تكنْ تلكَ الحزمةُ مستورَدةً **ثابتاً** من الحزمةِ التي تحوي `DriverRoot.tsx` — وهذا أساسُ القرارِ: الحزمةُ لازمةٌ للراكبِ والسائقِ
 *      معاً، فلا يُسخَّنُ إلّا ما يحتاجُه السطحانِ. فإن انفصلا سقطَ البناءُ وأُعيدَ النظرُ لا أن يُسخَّنَ ما يُهدَرُ.
 *
 * **ما لا تفعلُه:** لا تقرأُ دوراً ولا تخزّنُه (`F1-05`) · لا تضيفُ وسماً ثابتاً إلى المستندِ (طلباتُ أوّلِ رسمٍ ≤ 6).
 * **الحالة:** مُنفَّذ · مُختبَر (`tests/unit/warm-rider-home.test.ts`).
 */

import type { Plugin } from "vite";

export const WARM_PLACEHOLDER = "__WASLAH_WARM_RIDER_HOME__";

export interface WarmChunk {
  readonly fileName: string;
  readonly moduleIds: readonly string[];
  readonly imports: readonly string[];
}

/** اسمُ حزمةِ `rider-home` المبنيُّ، أو سببُ الرفضِ. نقيّةٌ لتُختبَر. */
export function resolveWarmChunk(
  chunks: readonly WarmChunk[],
):
  | { readonly ok: true; readonly fileName: string }
  | { readonly ok: false; readonly reason: string } {
  const rider = chunks.find((c) =>
    c.moduleIds.some((id) => id.endsWith("/surfaces/rider/RiderRoot.tsx")),
  );
  if (!rider) return { ok: false, reason: "لا حزمةَ تحوي `surfaces/rider/RiderRoot.tsx`" };
  const driver = chunks.find((c) =>
    c.moduleIds.some((id) => id.endsWith("/surfaces/driver/DriverRoot.tsx")),
  );
  if (!driver) return { ok: false, reason: "لا حزمةَ تحوي `surfaces/driver/DriverRoot.tsx`" };
  if (!driver.imports.includes(rider.fileName)) {
    return {
      ok: false,
      reason: `\`${driver.fileName}\` لا يستوردُ \`${rider.fileName}\` ثابتاً — التسخينُ يُهدَرُ على السائقِ (ADR 0187)`,
    };
  }
  return { ok: true, fileName: rider.fileName };
}

/** يستبدلُ العلامةَ في المستندِ مرّةً واحدةً بالضبطِ؛ وإلّا خطأٌ. نقيّةٌ لتُختبَر. */
export function injectWarmChunk(html: string, href: string): string {
  const parts = html.split(`"${WARM_PLACEHOLDER}"`);
  if (parts.length !== 2) {
    throw new Error(
      `F1-09 · D-31: علامةُ التسخينِ "${WARM_PLACEHOLDER}" يجبُ أن تظهرَ مرّةً واحدةً (وجدْتُ ${parts.length - 1})`,
    );
  }
  return parts.join(JSON.stringify(href));
}

export function warmRiderHome(): Plugin {
  return {
    name: "waslah-warm-rider-home",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        const chunks: WarmChunk[] = [];
        for (const item of Object.values(context.bundle ?? {})) {
          if (item.type !== "chunk") continue;
          chunks.push({
            fileName: item.fileName,
            moduleIds: item.moduleIds,
            imports: item.imports,
          });
        }
        const resolved = resolveWarmChunk(chunks);
        if (!resolved.ok) throw new Error(`F1-09 · D-31: ${resolved.reason}`);
        return injectWarmChunk(html, `/${resolved.fileName}`);
      },
    },
  };
}
