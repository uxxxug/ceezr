/**
 * الغرض: إثباتُ أنَّ الراكبَ الذي يفتحُ التطبيقَ بلا هدفٍ في الرابطِ — ومنهُ من
 *   عادَ بعدَ استردادِ جلسةٍ أثناءَ رحلةٍ (`WR-29` · ADR 0303) — يُتبِعُ رحلتَهُ
 *   الجاريةَ كما يُتبِعُ السائقُ مهمّتَهُ (`WR-20`).
 * الحالة: منفّذ فعلياً — البند `WR-29`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider
 *
 * حدٌّ معلَن: لا بيئةَ DOM — الرسمُ ساكنٌ (`renderToStaticMarkup`) يقيسُ أوّلَ
 * رسمٍ قبلَ أيِّ جلبٍ، والسلوكُ يُقاسُ بمصدرِ `RiderRoot.tsx` كما في
 * `driver-root.test.tsx` للسائقِ.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MINIAPP_LANGUAGES } from "../../../../../packages/shared/i18n/miniapp/index.ts";
import RiderRoot from "./RiderRoot.tsx";

const HERE = new URL(".", import.meta.url);
const SOURCE = readFileSync(new URL("./RiderRoot.tsx", HERE), "utf8");

/** الشِّفرةُ بلا تعليقات — كي لا يُحتسَبَ شرحٌ عربيٌّ نصّاً مُضمَّناً. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("WR-29 — متابعةُ الرحلةِ الجاريةِ عندَ الدخولِ الافتراضيِّ", () => {
  it("الهبوطُ الافتراضيُّ يسألُ عن الرحلةِ الجاريةِ ويُتبِعُها", () => {
    const code = codeOnly(SOURCE);
    // لا سؤالَ إلّا في الهبوطِ بلا هدفٍ صريحٍ — وإلّا نقضَ الرابطُ اختيارَ المستخدمِ.
    expect(code).toContain("if (!isDefaultRiderEntry(landing)) return;");
    // سؤالٌ واحدٌ خفيفٌ لا دوريّةَ، وصمتُ الخطأِ عاديٌّ: غيابُ الرحلةِ ليس عطلاً.
    expect(code).toContain("fetchActiveRideId()");
    expect(code).toContain("if (!cancelled && orderId !== null) setFollowed(orderId);");
    expect(code).toContain(".catch(() => undefined);");
  });

  for (const language of MINIAPP_LANGUAGES) {
    it(`الرسمُ الأولُ للراكبِ بلا هدفٍ لا يحملُ أثراً للسؤالِ · ${language}`, () => {
      const html = renderToStaticMarkup(<RiderRoot language={language} entry={null} />);
      // الجلبُ في مؤثّرٍ بعدَ الرسمِ: لا يظهرُ في الأوّلِ شيءٌ من متابعةِ رحلةٍ،
      // وأوّلُ رسمٍ هو بوّابةُ الترحيبِ (`wc__`) لا الشاشةُ الرئيسةُ (`F2-01`).
      expect(html).toContain('class="wc"');
      expect(html).not.toContain("srh__");
    });
  }
});
