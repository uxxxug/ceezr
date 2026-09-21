/**
 * الغرض: برهانُ القاعدةِ (٦) في حاجزِ النطاقِ الواحدِ — **من يُسمَحُ له بتأطيرِ
 *    التطبيقِ المصغَّرِ، محروساً في `render.yaml` لا في وسمِ `<meta>`** (`F1-10` ·
 *    `TG-005` · ADR 0165). ويُبرهَنُ بخرقٍ مبذورٍ في نصٍّ، وبالملفِّ الحقيقيِّ في
 *    حالتِه الراهنةِ.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: وظيفةُ `verify` في CI.
 * ملاحظات مستقبلية: كلُّ توجيهٍ يُضاف إلى رأسِ الاستجابةِ يُضاف له حكمٌ ههنا —
 *    ورأسٌ بلا حكمٍ يُعدَّل بلا أن يُخفِق شيءٌ.
 *
 * ولماذا نصٌّ مبذورٌ لا عبثٌ بالملفِّ الحقيقيِّ: الحكمُ دالّةٌ نقيّةٌ
 * (`analyseManifestHeaders`)، فيُبرهَنُ سقوطُها بلا أن يُمَسَّ ملفُّ النشرِ.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { analyseManifestHeaders } from "../../scripts/check-single-origin-assets.ts";
import { frameAncestorsHeaderValue } from "../../scripts/lib/content-security-policy.ts";

/** مانيفستٌ سليمٌ مختصرٌ — الحدُّ الأدنى الذي يجب أن يمرَّ. */
const SOUND = [
  "services:",
  "  - type: web",
  "    runtime: docker",
  "    name: waslah-gateway",
  "  - type: web",
  "    runtime: static",
  "    name: waslah-miniapp",
  "    headers:",
  "      - path: /*",
  "        name: Content-Security-Policy",
  `        value: ${frameAncestorsHeaderValue()}`,
  "      - path: /*",
  "        name: X-Content-Type-Options",
  "        value: nosniff",
  "  - type: worker",
  "    runtime: docker",
  "    name: waslah-worker",
  "    headers:",
  "      - path: /*",
  "        name: X-Frame-Options",
  "        value: DENY",
].join("\n");

const reasons = (manifest: string): string =>
  analyseManifestHeaders(manifest)
    .map((violation) => violation.why)
    .join(" | ");

describe("رأسُ التأطيرِ — F1-10 · TG-005 · ADR 0165", () => {
  it("مانيفستٌ سليمٌ يمرُّ", () => {
    expect(analyseManifestHeaders(SOUND)).toEqual([]);
  });

  it("غيابُ رأسِ السياسةِ ⇒ سقوطٌ — و`frame-ancestors` لا تعملُ في وسمٍ", () => {
    const seeded = SOUND.replace(
      `        name: Content-Security-Policy\n        value: ${frameAncestorsHeaderValue()}\n`,
      "",
    );
    expect(reasons(seeded)).toContain("لا تعملُ في وسمِ");
  });

  it("حضورُ X-Frame-Options ⇒ سقوطٌ — شاشةٌ بيضاءُ لا تشديدٌ", () => {
    const seeded = SOUND.replace(
      "        name: X-Content-Type-Options\n        value: nosniff",
      "        name: X-Frame-Options\n        value: SAMEORIGIN",
    );
    expect(reasons(seeded)).toContain("شاشةً بيضاءَ");
  });

  it("X-Frame-Options في خدمةٍ أخرى لا يُحاكَمُ — الحكمُ على كتلةِ التطبيقِ وحدَها", () => {
    // الكتلةُ الأخيرةُ في `SOUND` تحمل الرأسَ في خدمةِ العاملِ قصداً.
    expect(analyseManifestHeaders(SOUND)).toEqual([]);
  });

  it("قيمةٌ مغايرةٌ لما تبنيه وحدةُ السياسةِ ⇒ سقوطٌ", () => {
    const seeded = SOUND.replace(
      frameAncestorsHeaderValue(),
      "frame-ancestors https://example.com",
    );
    expect(reasons(seeded)).toContain("مصدَرُ الحقيقةِ");
  });

  it("توجيهُ جلبٍ في الرأسِ ⇒ سقوطٌ — مصدَرا حقيقةٍ لسياسةٍ واحدةٍ", () => {
    const seeded = SOUND.replace(
      frameAncestorsHeaderValue(),
      `${frameAncestorsHeaderValue()}; connect-src 'self'`,
    );
    expect(reasons(seeded)).toContain("توجيهُ جلبٍ");
  });

  it("خدمةٌ ليست ساكنةً ⇒ سقوطٌ — الرأسُ نصٌّ مُهمَلٌ في docker", () => {
    const seeded = SOUND.replace(
      "    runtime: static\n    name: waslah-miniapp",
      "    runtime: docker\n    name: waslah-miniapp",
    );
    expect(reasons(seeded)).toContain("نصٌّ مُهمَلٌ");
  });

  it("غيابُ خدمةِ التطبيقِ كلِّها ⇒ سقوطٌ لا تخطٍّ", () => {
    const seeded = SOUND.replace("    name: waslah-miniapp", "    name: waslah-other");
    expect(reasons(seeded)).toContain("حذفٌ لا حالةٌ أوّليّةٌ");
  });

  it("الملفُّ الحقيقيُّ في حالتِه الراهنةِ يمرُّ", () => {
    expect(analyseManifestHeaders(readFileSync("render.yaml", "utf8"))).toEqual([]);
  });
});
