/**
 * الغرض: إثباتُ أنّ تركيبَ سطحِ الإدارةِ **واحدٌ في الموضعَينِ** وأنّ ترتيبَ
 *   بادئاتِه محفوظٌ — `F5-08` / `ARCH-011` · ADR 0064. فالوحدةُ ادّعاءٌ حتّى يفشلَ
 *   شيءٌ إن انفكّت.
 * الحالة: منفّذ فعلياً — أُضيف مع `F5-08`.
 * ينتمي إلى: tests/unit
 * يُستخدم في: `bun run test` · وظيفةُ `verify` في CI.
 *
 * ## ولمَ اختبارٌ لترتيبِ ثلاثِ بادئاتٍ
 *
 * لأنّ الترتيبَ **شرطُ صحّةٍ لا ذوقٌ**: `Hono` يُطابِقُ أوّلَ بادئةٍ مُطابِقةٍ ولا
 * يتراجعُ. فلو رُكِّب `/admin` قبلَ `/admin/api` لالتقطَ طلبَ الواجهةِ كلَّ نداءِ
 * ‏API فأعادَ صفحةَ HTML لمن طلبَ JSON — عطلٌ يُقرأُ «خطأً في الواجهةِ» لا «خطأً في
 * ترتيبِ تركيبٍ»، ويُقضى فيه ساعاتٌ.
 *
 * وقبلَ هذه المرحلةِ كان الترتيبُ محفوظاً بأنّ الأسطرَ الثلاثةَ متجاورةٌ في
 * `apps/gateway/src/index.ts` وحدَه. وصار للسطحِ **مُركِّبانِ** (البوّابةُ وخدمةُ
 * اللوحةِ)، فحفظُ الترتيبِ بالتجاورِ لم يبقَ كافياً: يُصلَحُ في أحدِهما ويُنسى
 * الآخرُ فيختلف سلوكُ العنوانَينِ **بلا أن يُخفِقَ بناءٌ أو نوعٌ**. فوُحِّد
 * التركيبُ في `mountAdminSurface`، وهذا الملفُّ هو ما يجعل ذلك التوحيدَ مقيساً.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { ADMIN_MOUNT_PATHS } from "../../apps/gateway/src/admin/mount.ts";

const MOUNT_SOURCE = readFileSync("apps/gateway/src/admin/mount.ts", "utf8");
const GATEWAY_SOURCE = readFileSync("apps/gateway/src/index.ts", "utf8");
const ADMIN_ENTRY_SOURCE = readFileSync("apps/admin/src/index.ts", "utf8");

/** ترتيبُ ظهورِ بادئاتِ `app.route` الفعليّةِ في نصِّ المُركِّبِ. */
function routedPathsInSource(source: string): readonly string[] {
  return [...source.matchAll(/app\.route\(\s*"([^"]+)"/g)].map((match) => match[1] ?? "");
}

describe("ترتيبُ تركيبِ سطحِ الإدارةِ — F5-08 / ARCH-011 · ADR 0064", () => {
  /**
   * القائمةُ المُصدَّرةُ ليست وثيقةً بل **وعدٌ**: تُطابِقُ ما يُركَّب فعلاً. ولو
   * كانت وصفاً حرّاً لكانت أسوأَ من لا شيءٍ — قارئٌ يثق بها وهي كاذبةٌ.
   */
  it("القائمةُ المُصدَّرةُ تُطابِقُ ما يُركَّبُ فعلاً، ترتيباً وعدداً", () => {
    expect(routedPathsInSource(MOUNT_SOURCE)).toEqual([...ADMIN_MOUNT_PATHS]);
  });

  /**
   * والترتيبُ نفسُه يُفحَص بحكمٍ لا بمطابقةِ نصٍّ: **الأخصُّ أوّلاً**. فمَن أضافَ
   * بادئةً رابعةً غداً لا يُصلِحُ ثابتاً حُفِظت فيه قائمةٌ قديمةٌ، بل يُلزَمُ
   * بالقاعدةِ ذاتِها. ولا بادئةٌ تسبقُ بادئةً هي جزءٌ منها.
   */
  it("الأخصُّ قبلَ الأعمِّ: لا بادئةٌ تسبقُ ما هي بادئةٌ له", () => {
    const paths = ADMIN_MOUNT_PATHS;
    for (let earlier = 0; earlier < paths.length; earlier += 1) {
      for (let later = earlier + 1; later < paths.length; later += 1) {
        const first = paths[earlier] ?? "";
        const second = paths[later] ?? "";
        // الأسبقُ لا يجوز أن يكون بادئةً للاحقِ: لو كان لالتقطَ طلباتِه كلَّها.
        expect(second.startsWith(`${first}/`)).toBe(false);
      }
    }
  });

  /**
   * **الوحدةُ**: لا موضعَ ثانياً يُركِّبُ موجّهاً إداريّاً بيدِه. فنقطتا الدخولِ
   * تنادِيانِ `mountAdminSurface` ولا تُنشئانِ `createAdmin*Routes` بنفسِهما —
   * وهذا ما يجعل «التركيبُ في موضعٍ واحدٍ» جملةً مقيسةً لا نيّةً حسنةً.
   */
  it("لا نقطةَ دخولٍ تُركِّبُ موجّهاً إداريّاً بيدِها", () => {
    for (const source of [GATEWAY_SOURCE, ADMIN_ENTRY_SOURCE]) {
      expect(source).toContain("mountAdminSurface");
      expect(source).not.toContain("createAdminUiRoutes");
      expect(source).not.toContain("createAdminApiRoutes");
      expect(source).not.toContain("createAdminLiveRoutes");
    }
  });

  /**
   * وتركيبُ البوّابةِ **مشروطٌ** بموضعِ اللوحةِ: بلا الشرطِ يُركَّب السطحُ دائماً
   * فلا يكون في المتغيّرِ أثرٌ — أي إعلانٌ يُقرأُ ولا يُطاع، وهو أسوأُ من غيابِه.
   */
  it("البوّابةُ تُركِّبُ السطحَ مشروطاً بـrunAdminInGateway", () => {
    expect(GATEWAY_SOURCE).toContain("config.runAdminInGateway");
    const conditionAt = GATEWAY_SOURCE.indexOf("config.runAdminInGateway");
    const mountAt = GATEWAY_SOURCE.indexOf("mountAdminSurface(app");
    expect(conditionAt).toBeGreaterThan(-1);
    expect(mountAt).toBeGreaterThan(conditionAt);
  });

  /** وخدمةُ اللوحةِ تُركِّبُهُ بلا شرطٍ: وجودُها **هو** الشرطُ. */
  it("خدمةُ اللوحةِ تُركِّبُ السطحَ بلا شرطٍ", () => {
    expect(ADMIN_ENTRY_SOURCE).toContain("mountAdminSurface(app,");
    expect(ADMIN_ENTRY_SOURCE).not.toContain("if (config.value.runAdminInGateway) {\n    mount");
  });
});
