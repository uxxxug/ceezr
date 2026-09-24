/**
 * الغرض: إثباتُ أنَّ حاجزَ موضعِ التقديمِ (`F1-09` · `D-27`) يقبلُ السكربتَ الكلاسيكيَّ
 *   المستقلَّ ويرفضُ الصورةَ التي أنتجها Vite فعلاً (التقديمُ مطويٌّ في وحدةِ المدخلِ بعدَ
 *   `import` الحزمِ) — مع أثرِ التعليقاتِ التي تذكرُ الوسمَ نصّاً.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { prebootPlacementViolations } from "../../apps/miniapp/vite/assert-preboot-placement.ts";

const PREBOOT = "(function(){window.__waslahPreboot={};})();";

describe("prebootPlacementViolations (F1-09 · D-27)", () => {
  it("يقبلُ سكربتاً كلاسيكيّاً مستقلّاً بعدَ المدخلِ المُدمَج", () => {
    const html = `<head><script type="module">import{a}from"/assets/shell-x.js";a();</script></head><body><div id="root"></div><script>${PREBOOT}</script></body>`;
    expect(prebootPlacementViolations(html)).toEqual([]);
  });

  it("يرفضُ التقديمَ المطويَّ في وحدةِ المدخلِ (صورةُ العطبِ المقيسةِ)", () => {
    const html = `<script type="module">import{a}from"/assets/shell-x.js";import"/assets/vendor-react-y.js";${PREBOOT}a();</script>`;
    const violations = prebootPlacementViolations(html);
    expect(violations.length).toBe(2);
  });

  it("يرفضُ غيابَ التقديمِ", () => {
    expect(prebootPlacementViolations("<script>1</script>").length).toBe(1);
  });

  it("يرفضُ التأجيلَ", () => {
    expect(prebootPlacementViolations(`<script defer>${PREBOOT}</script>`).length).toBe(1);
  });

  it("لا يُخدَعُ بتعليقٍ يذكرُ التقديمَ", () => {
    const html = `<!-- <script type="module">__waslahPreboot</script> --><script>${PREBOOT}</script>`;
    expect(prebootPlacementViolations(html)).toEqual([]);
  });
});
