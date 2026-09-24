/**
 * الغرض: إثباتُ أنَّ تسخينَ `rider-home` (`F1-09` · `D-31` · `ADR 0187`) لا يُحقَنُ إلّا لحزمةٍ يستوردُها سطحُ السائقِ ثابتاً،
 *   وأنَّ علامةَ السكربتِ الساكنِ تُستبدَلُ مرّةً واحدةً بالضبطِ.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  injectWarmChunk,
  resolveWarmChunk,
  WARM_PLACEHOLDER,
  type WarmChunk,
} from "../../apps/miniapp/vite/warm-rider-home.ts";

const RIDER: WarmChunk = {
  fileName: "assets/rider-home-A.js",
  moduleIds: ["/app/src/surfaces/rider/RiderRoot.tsx"],
  imports: ["assets/shell-B.js"],
};
const driver = (imports: string[]): WarmChunk => ({
  fileName: "assets/driver-C.js",
  moduleIds: ["/app/src/surfaces/driver/DriverRoot.tsx"],
  imports,
});

describe("resolveWarmChunk (F1-09 · D-31)", () => {
  it("يُعيدُ حزمةَ الراكبِ حينَ يستوردُها السائقُ ثابتاً", () => {
    expect(resolveWarmChunk([RIDER, driver(["assets/rider-home-A.js"])])).toEqual({
      ok: true,
      fileName: "assets/rider-home-A.js",
    });
  });

  it("يرفضُ حينَ انفصلَ السطحانِ — التسخينُ يُهدَرُ على السائقِ", () => {
    const r = resolveWarmChunk([RIDER, driver(["assets/shell-B.js"])]);
    expect(r.ok).toBe(false);
  });

  it("يرفضُ حينَ لا حزمةَ للراكبِ أو للسائقِ", () => {
    expect(resolveWarmChunk([driver([])]).ok).toBe(false);
    expect(resolveWarmChunk([RIDER]).ok).toBe(false);
  });
});

describe("injectWarmChunk (F1-09 · D-31)", () => {
  it("يستبدلُ العلامةَ مرّةً واحدةً", () => {
    const html = `<script>var warm = "${WARM_PLACEHOLDER}";</script>`;
    expect(injectWarmChunk(html, "/assets/rider-home-A.js")).toBe(
      '<script>var warm = "/assets/rider-home-A.js";</script>',
    );
  });

  it("يرفضُ غيابَ العلامةِ أو تكرارَها", () => {
    expect(() => injectWarmChunk("<script></script>", "/x.js")).toThrow();
    const twice = `"${WARM_PLACEHOLDER}" "${WARM_PLACEHOLDER}"`;
    expect(() => injectWarmChunk(twice, "/x.js")).toThrow();
  });
});
