/**
 * الغرض: إثباتُ ربطِ الاستردادِ التلقائيِّ للجلسةِ (`WR-29` · ADR 0303) في الهيكلِ:
 *   تسجيلُ مُقيمِ الجلسةِ من `Shell` لا من حدِّ النقلِ، وتركيبُ الموجّهِ بمفتاحٍ
 *   جديدٍ عندَ نجاحِهِ (كما في إعادةِ المصادقةِ `SS-05`)، وفكُّ التسجيلِ عندَ
 *   التفكيكِ.
 * الحالة: منفّذ فعلياً — البند `WR-29`.
 * ينتمي إلى: apps/miniapp/src/shell
 *
 * حدٌّ معلَن: لا بيئةَ DOM ولا شبكةَ — الرسمُ ساكنٌ والسلوكُ يُقاسُ بمصدرِ
 * `Shell.tsx` نفسِهِ كما في `driver-root.test.tsx` للسائقِ (`WR-20`).
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { IdentityPort } from "./identity-port.ts";
import { Shell } from "./Shell.tsx";

const HERE = new URL(".", import.meta.url);
const SOURCE = readFileSync(new URL("./Shell.tsx", HERE), "utf8");

/** الشِّفرةُ بلا تعليقات — كي لا يُحتسَبَ شرحٌ عربيٌّ نصّاً مُضمَّناً. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const never = () => new Promise<never>(() => {});
const identity: IdentityPort = {
  establishSession: never,
  clearSession: () => undefined,
  fetchViewer: never,
};

describe("WR-29 — تسجيلُ الاستردادِ في الهيكلِ", () => {
  it("يسجّلُ مُقيمَ جلسةٍ ويُعيدُ تركيبَ الموجّهِ عندَ نجاحِهِ", () => {
    const code = codeOnly(SOURCE);
    // التسجيلُ من الهيكلِ لا من حدِّ النقلِ — والفكُّ عندَ التفكيكِ.
    expect(code).toContain("registerSessionRecovery(async () => {");
    expect(code).toContain("return () => registerSessionRecovery(null);");
    // الاستردادُ الناجحُ يُقيمُ الجلسةَ ثمّ يركّبُ الموجّهَ بمفتاحٍ جديدٍ: عودةٌ
    // إلى الرحلةِ الجاريةِ لا إلى شاشةِ خطأٍ (قرارُ المالكِ بعدَ التجربةِ).
    expect(code).toContain('setBoot({ kind: "ready" });');
    expect(code).toContain("setSessionEpoch((value) => value + 1);");
    expect(code).toContain("return true;");
    // الفشلُ يُعادَ `false` لا استثناءً: فشلُ الاستردادِ لا يُخفي رفضَ الخادمِ.
    expect(code).toContain("if (!result.established) return false;");
  });

  it("الإقلاعُ بلا جلسةٍ لا يرسمُ سطحَ منتجٍ — الاستردادُ لا يغيّرُ الحكمَ الأولَ", () => {
    const html = renderToStaticMarkup(<Shell identity={identity} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("rh__");
    expect(html).not.toContain("wc__");
  });
});
