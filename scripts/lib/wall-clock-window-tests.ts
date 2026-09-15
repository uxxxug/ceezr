/**
 * الغرض: قاعدةُ حاجزٍ واحدةٌ — **اختبارٌ يقرأُ نافذةً محليّةً لا يُثبِّتُ منطقةَ
 *   زمنٍ بحرفٍ**. النافذةُ تبدأُ عندَ منتصفِ ليلِ المدينةِ، فمَن ثبَّتَ المنطقةَ
 *   نصّاً وزرعَ صفّاً «قبلَ ساعتَينِ» قاسَ **ساعةَ الحائطِ** لا الدالّةَ.
 * الحالة: منفّذ فعلياً — بوّابةُ CI.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: scripts/check-wall-clock-window-tests.ts و
 *   tests/unit/check-wall-clock-window-tests.test.ts
 * يُتوقع أن يستخدمه لاحقاً: كلُّ بندٍ يقيسُ تقريراً بنافذةِ يومٍ أو أسبوعٍ أو شهرٍ —
 *   حصيلةُ السائقِ، وكشفُ الاشتراكِ، وكلُّ تقريرٍ محسوبٍ بمنطقةِ زمنِ المدينةِ.
 * الحاكم: docs/adr/0123-a-local-window-is-not-the-wall-clock.md
 *
 * ## لماذا وُجِدَ هذا الحاجزُ
 * `driver_activity_window` تحسبُ `[from, to)` بـ`date_trunc` على الزمنِ **المحليِّ**
 * لمنطقةِ المدينةِ. فاختبارٌ يُثبِّتُ `city_timezone` على `Asia/Riyadh` نصّاً ثمَّ
 * يزرعُ تبديلَ تواجدٍ «قبلَ ثلاثينَ دقيقةً» أو رحلةً «قبلَ ساعتَينِ» ويقرأُ نافذةَ
 * `day`: **يمرُّ نهاراً ويسقطُ بعدَ منتصفِ الليلِ** — لأنَّ النافذةَ حينَها عمرُها
 * دقائقُ، فيُقَصُّ الزرعُ على حدِّها أو يسقُطُ خارجَها.
 *
 * وقد دُفِعَ الثمنُ في البندِ `F3-07`: دورةُ CI عندَ ٢١:١٨Z (٠٠:١٨ بالرياضِ) أسقطَت
 * فحصَينِ في `tests/integration/driver-activity.test.ts` — ١٠٠٤ ناجحاً و٢ ساقطَينِ —
 * وهما فحصانِ **صحيحانِ منتجاً وكاذبانِ قياساً**: لم يتغيّر شيءٌ إلّا الساعةُ.
 *
 * والبديلُ الصادقُ: **تُحسَبُ** منطقةُ الزمنِ من ساعةِ القاعدةِ بحيثُ يقعُ «الآنَ»
 * وسَطَ اليومِ المحليِّ (`Etc/GMT±N` — إزاحةٌ ثابتةٌ بلا توقيتٍ صيفيٍّ)، ثمَّ يُثبَتُ
 * أنَّ حدَّي النافذةِ بعيدانِ بما يكفي. فالحدُّ يُثبَّتُ ولا يُخفَّفُ الرقمُ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 * ــ **لا يمنعُ اسمَ منطقةٍ في نداءِ الدالّةِ نفسِها**: `driver_activity_window(
 *    'day', 'Asia/Riyadh', '2026-09-15T22:30:00Z')` قياسٌ للحدِّ عندَ حدِّه بزمنٍ
 *    **مُعطىً**، وهوَ الاستخدامُ الصحيحُ المطلوبُ — الممنوعُ هوَ **كتابةُ الإعدادِ**.
 * ــ **لا يمسُّ ملفّاً لا يقرأُ نافذةً**: لا معنى للقاعدةِ فيه.
 * ــ **لا يقيسُ أنَّ الزرعَ نسبيٌّ**: قد يزرعُ ملفٌّ أختاماً مطلقةً ويُعطي `p_now`
 *    صراحةً؛ ذاكَ مُحكَمٌ أصلاً. القاعدةُ على **كتابةِ الإعدادِ** التي تجعلُ
 *    النافذةَ رهنَ الساعةِ.
 * ــ **لا يُصلِحُ آلياً**: المنطقةُ المحسوبةُ وشرطُ البُعدِ عن الحدِّ قرارُ مؤلِّفِ
 *    الاختبارِ، وحقنُهما تخميناً يُنتِجُ اختباراً يمرُّ بلا أن يقيسَ.
 */

import { toPosixPath } from "./repo-path.ts";

/** جذورُ الاختباراتِ المفحوصةُ. */
export const TEST_ROOTS: readonly string[] = ["tests"];

/**
 * ملفُّ السالباتِ المزروعةِ وحدَه: واجبُهُ أن يحملَ النمطَ الممنوعَ نصّاً — ومنهُ
 * **السطرُ الذي أسقطَ CI في `F3-07`** — وإلّا لم يُقَسِ الحاجزُ (`ح-٧`).
 */
export const PLANTED_NEGATIVE_FILES: ReadonlySet<string> = new Set([
  "tests/unit/check-wall-clock-window-tests.test.ts",
]);

/** الرخصةُ المُعلَنةُ: سببٌ مكتوبٌ في السطرِ نفسِه — لا صمتٌ ولا استثناءٌ مخفيٌّ. */
export const ALLOW_MARKER = "wall-clock-irrelevant:";

export interface WallClockWindowViolation {
  readonly file: string;
  readonly line: number;
  readonly setting: string;
  readonly zone: string;
}

/** دوالُّ التقاريرِ التي تشتقُّ نافذتَها من `now()` داخلَها — لا من معامِلٍ مُعطىً. */
const WINDOWED_READERS = /\b(driver_activity_summary|driver_activity_entries)\s*\(/;

/** كتابةُ إعدادٍ لا قراءتُه: هذهِ وحدَها تجعلُ النافذةَ رهنَ ساعةِ الحائطِ. */
const SETTING_WRITE =
  /\b(setSetting|withSetting|insert\s+into\s+platform_settings|update\s+platform_settings)\b/;

/** المفتاحُ المقصودُ — بحرفِه أو بثابتِه المعروفِ في ملفّاتِ هذا المستودَعِ. */
// ولا `\b` قبلَ المجموعةِ: لا حدَّ كلمةٍ بينَ `(` و`'`، فالقَيدُ يُسقِطُ
// `withSetting('city_timezone', …)` — وقد أسقطَه فعلاً حتّى التقَطَته السالباتُ المزروعةُ.
const TIMEZONE_KEY = /(\bKEY_TIMEZONE\b|['"`]city_timezone['"`])/;

/** اسمُ منطقةٍ مكتوبٌ حرفاً: `"Asia/Riyadh"` و`'Etc/GMT+3'` وأمثالُهما. */
const ZONE_LITERAL = /['"`]([A-Za-z]+(?:_[A-Za-z]+)*\/[A-Za-z0-9_+-]+)['"`]/;

/**
 * يمحو تعليقاتِ JavaScript مع الحفاظِ على عددِ الأسطرِ ليصدُقَ رقمُ السطرِ — إلّا
 * تعليقَ الرخصةِ المُعلَنةِ، فهوَ **جزءٌ من الحكمِ** لا حاشيةٌ.
 */
function blankJsComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    "\n".repeat((block.match(/\n/g) ?? []).length),
  );
  return withoutBlocks
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      if (at === -1) return line;
      return line.includes(ALLOW_MARKER) ? line : line.slice(0, at);
    })
    .join("\n");
}

/**
 * يقرأُ نصَّ ملفِّ اختبارٍ ويردُّ خرقَه. دالّةٌ خالصةٌ: يُقاسُ الحاجزُ بنصٍّ مزروعٍ
 * لا بما يصادفُه القرصُ (`ح-٧`).
 */
export function wallClockWindowViolationsIn(
  file: string,
  source: string,
): readonly WallClockWindowViolation[] {
  if (PLANTED_NEGATIVE_FILES.has(toPosixPath(file))) return [];
  const code = blankJsComments(source);
  if (!WINDOWED_READERS.test(code)) return [];

  const found: WallClockWindowViolation[] = [];
  const lines = code.split("\n");
  const flagged = new Set<number>();

  // كتابةُ الإعدادِ **تُقرأُ كتلةً** لا سطراً: `insert into platform_settings`
  // يقعُ مفتاحُه وقيمتُه في أسطرٍ تاليةٍ، وحاجزٌ يقرأُ السطرَ وحدَه يمرُّ
  // أخضرَ على أوضحِ صورةٍ من الخرقِ — وذاكَ أسوأُ من لا حاجزٍ.
  const BLOCK_LINES = 3;
  for (const [index, line] of lines.entries()) {
    if (!SETTING_WRITE.test(line)) continue;
    const block = lines.slice(index, index + BLOCK_LINES + 1);
    if (block.some((text) => text.includes(ALLOW_MARKER))) continue;
    if (!block.some((text) => TIMEZONE_KEY.test(text))) continue;
    for (const [offset, text] of block.entries()) {
      const zone = ZONE_LITERAL.exec(text);
      if (zone === null) continue;
      const at = index + offset + 1;
      if (flagged.has(at)) break;
      flagged.add(at);
      found.push({
        file,
        line: at,
        setting: "city_timezone",
        zone: zone[1] ?? "(منطقةٌ بلا اسمٍ مقروءٍ)",
      });
      break;
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

/** رسالةُ الخرقِ — تقولُ البديلَ لا العيبَ وحدَه. */
export function describeWallClockWindowViolation(violation: WallClockWindowViolation): string {
  return [
    `${violation.file}:${String(violation.line)}: ${violation.setting} = «${violation.zone}»`,
    "      منطقةُ زمنٍ مُثبَّتةٌ بحرفٍ في ملفٍّ يقرأُ نافذةً محليّةً: نافذةُ `day`",
    "      تبدأُ عندَ منتصفِ ليلِ المدينةِ، فالزرعُ النسبيُّ يُقَصُّ أو يسقطُ خارجَها",
    "      بعدَ منتصفِ الليلِ — يمرُّ نهاراً ويسقطُ ليلاً بلا تغيُّرِ منتَجٍ.",
    "      البديلُ: احسِب المنطقةَ من ساعةِ القاعدةِ ليقعَ «الآنَ» وسَطَ اليومِ",
    `      (\`Etc/GMT±N\`) وأثبِت بُعدَ الحدَّينِ، أو علِّل بـ«${ALLOW_MARKER} …» (ADR 0123).`,
  ].join("\n");
}
