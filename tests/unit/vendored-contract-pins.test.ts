/**
 * الغرض: برهانُ **سقوطِ** حاجزِ تثبيتِ مصدرِ العقودِ المنقولةِ بخرقٍ مزروعٍ —
 *   ملفٌّ بلا سندٍ، وسندٌ لملفٍّ محذوفٍ، وسندانِ لملفٍّ واحدٍ، والتزامٌ مختصرٌ،
 *   ومستودَعٌ بلا مالكٍ، ومسارٌ يصعدُ — ونجاحِه على السجلِّ الحقيقيِّ.
 *   البند `DEP-CORE-005`.
 * الحالة: منفّذ فعلياً — 2026-09-12 · البند `DEP-CORE-005`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test tests/unit` وسلسلةُ `ci`.
 * ملاحظات مستقبلية: لو صارَ للسندِ صيغةٌ مُهيكلةٌ تُبدَّلُ النصوصُ المزروعةُ
 *   ههنا ويبقى الحكمُ نفسَه: لا ملفَّ بلا سندٍ ولا سندَ بلا ملفٍّ.
 *
 * ## لِمَ يُقاسُ السقوطُ لا النجاحُ وحدَه
 *
 * حاجزٌ يُثبَتُ نجاحُه ولا يُثبَتُ سقوطُه قد لا يقرأُ شيئاً ألبتّةَ: تعبيرٌ لا
 * يُطابِقُ سطراً واحداً يُخرِجُ «صفرَ خروقٍ» فيُقرأُ أخضرَ، وهذا أخطرُ من غيابِ
 * الحاجزِ لأنَّه يُوَرِّثُ ثقةً. فيُزرَعُ ههنا كلُّ صنفِ خرقٍ ويُطلَبُ صراخُه
 * باسمِ الملفِّ وسببِه.
 */

import { describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditPins,
  CONTRACTS_DIR,
  listVendored,
  parseProvenance,
  readProvenance,
} from "../../scripts/lib/vendored-contract-pins.ts";

const REAL_COMMIT = "511624b3439c51558dcf9e126d27fc1d2377f280";
const SAMPLE = "envelope.schema.json";

function sandbox(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pins-")), "core");
  cpSync(CONTRACTS_DIR, dir, { recursive: true });
  return dir;
}

function appendProvenance(dir: string, line: string): void {
  const path = join(dir, "PROVENANCE.md");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n${line}\n`);
}

describe("تفكيكُ سجلِّ العقودِ — دالّةٌ خالصةٌ على نصٍّ مزروعٍ", () => {
  it("يقرأُ السندَ والبصمةَ ولا يخلطُ بينَهما", () => {
    const record = parseProvenance(
      [
        "نثرٌ لا يُفكَّكُ: الالتزامُ 511624b وحدَه في جملةٍ.",
        `pin uxxxug/wasla-core ${REAL_COMMIT} contracts/events/envelope.schema.json -> envelope.schema.json`,
        `${"a".repeat(64)}  envelope.schema.json`,
      ].join("\n"),
    );

    expect(record.parseBreaches).toEqual([]);
    expect(record.pins.get("envelope.schema.json")).toEqual({
      repo: "uxxxug/wasla-core",
      commit: REAL_COMMIT,
      sourcePath: "contracts/events/envelope.schema.json",
      vendoredPath: "envelope.schema.json",
    });
    expect(record.fingerprints.get("envelope.schema.json")).toBe("a".repeat(64));
  });

  it("التزامٌ مختصرٌ لا يُقرأُ سنداً — المختصرُ يتصادمُ فلا يُثبِّتُ", () => {
    const record = parseProvenance("pin uxxxug/wasla-core 511624b contracts/x.json -> x.json");
    expect(record.pins.size).toBe(0);
  });

  it("مستودَعٌ بلا مالكٍ خرقٌ مُسمَّىً لا سطرٌ مُتجاهَلٌ", () => {
    const record = parseProvenance(`pin waslacore ${REAL_COMMIT} contracts/x.json -> x.json`);
    expect(record.pins.size).toBe(0);
    expect(record.parseBreaches[0]).toContain("owner/repo");
  });

  it("مسارٌ يصعدُ خارجَ الشجرةِ يُرفَضُ", () => {
    const record = parseProvenance(
      `pin uxxxug/wasla-core ${REAL_COMMIT} ../../etc/passwd -> x.json`,
    );
    expect(record.pins.size).toBe(0);
    expect(record.parseBreaches[0]).toContain("يصعدُ");
  });

  it("سندانِ لملفٍّ واحدٍ خرقٌ: لا يُسكَتُ بترجيحِ الأخيرِ", () => {
    const record = parseProvenance(
      [
        `pin uxxxug/wasla-core ${REAL_COMMIT} contracts/a.json -> x.json`,
        `pin uxxxug/wasla-core ${"b".repeat(40)} contracts/b.json -> x.json`,
      ].join("\n"),
    );
    expect(record.pins.size).toBe(1);
    expect(record.parseBreaches[0]).toContain("تثبيتانِ لملفٍّ واحدٍ");
  });
});

describe("حاجزُ التثبيتِ — السجلُّ الحقيقيُّ", () => {
  it("لا خرقَ في `docs/contracts/core` كما هوَ الآنَ", () => {
    expect(auditPins()).toEqual([]);
  });

  it("كلُّ ملفٍّ منقولٍ حقيقيٍّ له سندٌ — عدداً لا دعوىً", () => {
    const vendored = listVendored(CONTRACTS_DIR);
    const { pins } = readProvenance();
    expect(vendored.length).toBeGreaterThan(0);
    expect(pins.size).toBe(vendored.length);
    for (const rel of vendored) expect(pins.has(rel)).toBe(true);
  });
});

describe("حاجزُ التثبيتِ — خرقٌ مزروعٌ", () => {
  it("ملفٌّ منقولٌ بلا سندٍ يُسقِطُ الحاجزَ ويُسمّيه", () => {
    const dir = sandbox();
    writeFileSync(join(dir, "transport/smuggled.yaml"), "openapi: 3.1.0\n");
    // تُزادُ بصمتُه فلا يختلطُ خرقُ السندِ بخرقِ البصمةِ.
    appendProvenance(dir, `${"c".repeat(64)}  transport/smuggled.yaml`);

    const breaches = auditPins(dir);

    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toContain("smuggled.yaml");
    expect(breaches[0]).toContain("بلا سطرِ تثبيتٍ");
  });

  it("سندٌ لملفٍّ غائبٍ يُسقِطُ الحاجزَ — لا سندَ لمعدومٍ", () => {
    const dir = sandbox();
    appendProvenance(
      dir,
      `pin uxxxug/wasla-core ${REAL_COMMIT} contracts/events/vanished.schema.json -> vanished.schema.json`,
    );

    const breaches = auditPins(dir);

    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toContain("vanished.schema.json");
    expect(breaches[0]).toContain("تثبيتٌ بلا ملفٍّ");
  });

  it("حذفُ ملفٍّ منقولٍ يُسقِطُ الحاجزَ بسندٍ صارَ كاذباً", () => {
    const dir = sandbox();
    rmSync(join(dir, SAMPLE));

    const breaches = auditPins(dir);

    expect(breaches.some((breach) => breach.includes(SAMPLE))).toBe(true);
  });

  it("سجلٌّ بلا سندٍ واحدٍ يُسقِطُ الحاجزَ ولا يُقرأُ نجاحاً", () => {
    const dir = sandbox();
    writeFileSync(join(dir, "PROVENANCE.md"), "# سجلٌّ أُفرِغَ\n");

    const breaches = auditPins(dir);

    expect(breaches[0]).toContain("لا سطرَ تثبيتٍ واحداً");
    expect(breaches.length).toBeGreaterThan(1);
  });
});
