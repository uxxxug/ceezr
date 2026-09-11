/**
 * الغرض: برهانُ **سقوطِ** حاجزِ سلامةِ العقودِ المنقولةِ بخرقٍ مزروعٍ — بايتٌ
 *   مُغيَّرٌ، وملفٌّ بلا بصمةٍ، وبصمةٌ بلا ملفٍّ، وسجلٌّ فارغٌ — ونجاحِه على
 *   `docs/contracts/core/` الحقيقيِّ في حالتِه الراهنةِ. البند `W-5`.
 * الحالة: منفّذ فعلياً — 2026-09-12.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test tests/unit` وسلسلةُ `ci`.
 * ملاحظات مستقبلية: يومَ يُقابَلُ المنقولُ برأسِ CORE مباشرةً (`DEP-CORE-005`)
 *   يُزادُ ههنا خرقٌ مزروعٌ خامسٌ: بصمةٌ مُطابِقةٌ لملفٍّ قديمٍ ومُخالِفةٌ للرأسِ.
 *
 * ## لِمَ يُقاسُ الحاجزُ نفسُه
 *
 * حاجزٌ لا يُقاسُ سقوطُه ليسَ حاجزاً بل زينةٌ: قد يمرُّ أخضرَ سنةً كاملةً لأنَّه لا
 * يقرأُ شيئاً أصلاً — مسارٌ خاطئٌ، أو مُطابِقٌ لا يُطابِقُ، أو حلقةٌ على قائمةٍ
 * فارغةٍ. وهذا الحاجزُ وُلِدَ من دليلٍ كاذبٍ فعليٍّ (بصمتانِ بطلتا بإعادةِ تنسيقٍ)،
 * فأولى ما يُصانُ فيه أنَّه يصرخُ حينَ يجبُ الصراخُ.
 */

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditVendoredContracts,
  CONTRACTS_DIR,
} from "../../scripts/check-vendored-contract-integrity.ts";

const SAMPLE = "transport/outbound-delivery.md";

/** نسخةٌ مؤقّتةٌ من المنقولِ الحقيقيِّ — يُزرَعُ فيها الخرقُ ولا يُمَسُّ المستودعُ. */
function sandbox(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "vendored-")), "core");
  cpSync(CONTRACTS_DIR, dir, { recursive: true });
  return dir;
}

describe("حاجزُ سلامةِ العقودِ المنقولةِ — المستودعُ الحقيقيُّ", () => {
  it("لا خرقَ في `docs/contracts/core` كما هوَ الآنَ", () => {
    expect(auditVendoredContracts()).toEqual([]);
  });

  it("النسخةُ المؤقّتةُ من الحقيقيِّ تمرُّ كذلكَ — فالمقياسُ يقرأُ جذرَه المُمرَّرَ", () => {
    expect(auditVendoredContracts(sandbox())).toEqual([]);
  });
});

describe("حاجزُ سلامةِ العقودِ المنقولةِ — خرقٌ مزروعٌ", () => {
  it("بايتٌ واحدٌ مُغيَّرٌ يُسقِطُ الحاجزَ ويُسمّي الملفَّ", () => {
    const dir = sandbox();
    const path = join(dir, SAMPLE);
    const original = readFileSync(path, "utf8");
    // فراغٌ واحدٌ زائدٌ في آخرِ الملفِّ: أخفُّ ما يُمكنُ، ولا يُغيِّرُ معنىً لعينٍ.
    writeFileSync(path, `${original} `);

    const breaches = auditVendoredContracts(dir);

    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toContain(SAMPLE);
    expect(breaches[0]).toContain("البصمةُ لا تُطابِقُ");
  });

  it("ملفٌّ منقولٌ بلا بصمةٍ في السجلِّ يُسقِطُ الحاجزَ — لا نقلَ بلا إثباتٍ", () => {
    const dir = sandbox();
    writeFileSync(join(dir, "transport/smuggled.yaml"), "openapi: 3.1.0\n");

    const breaches = auditVendoredContracts(dir);

    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toContain("smuggled.yaml");
    expect(breaches[0]).toContain("بلا بصمةٍ");
  });

  it("بصمةٌ مكتوبةٌ لملفٍّ غائبٍ تُسقِطُ الحاجزَ — لا إثباتَ لمعدومٍ", () => {
    const dir = sandbox();
    const provenance = join(dir, "PROVENANCE.md");
    const digest = createHash("sha256").update("لا شيءَ").digest("hex");
    writeFileSync(
      provenance,
      `${readFileSync(provenance, "utf8")}\n${digest}  transport/vanished.md\n`,
    );

    const breaches = auditVendoredContracts(dir);

    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toContain("vanished.md");
    expect(breaches[0]).toContain("بلا ملفٍّ");
  });

  it("سجلٌّ بلا بصمةٍ واحدةٍ يُسقِطُ الحاجزَ ولا يُقرأُ نجاحاً", () => {
    const dir = sandbox();
    writeFileSync(join(dir, "PROVENANCE.md"), "# سجلٌّ أُفرِغَ\n");

    const breaches = auditVendoredContracts(dir);

    // خرقُ الفراغِ، ثمَّ خرقٌ لكلِّ ملفٍّ منقولٍ صارَ بلا بصمةٍ.
    expect(breaches.length).toBeGreaterThan(1);
    expect(breaches[0]).toContain("سجلٌّ فارغٌ");
  });
});
