/**
 * LOAD-01 §5.8 — عقدُ جامعِ جردِ المطالباتِ (claim-inventory.py):
 * قراءةٌ كاملةٌ ناجحة ⇒ أرقامٌ صريحةٌ (غيابُ الاستعلامِ = صفرٌ مقيسٌ)،
 * وفشلٌ في القراءةِ أو التحليلِ ⇒ null فلا يمرُّ أيُّ فحصٍ (الغائبُ ليسَ صفرًا).
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(
  import.meta.dir,
  "../../deploy/capacity-run/b24-runner/seat-bin/claim-inventory.py",
);
const CLAIM_SIG = "select claim_notification_delivery() result";
const CORR_SIG = "select request_id from notification_outbox where id = $1::uuid";

type Result = {
  arm: string;
  claims: number | null;
  correlation: number | null;
  queriesPerClaim: number | null;
};

function runCollector(csvContent: string | null, arm = "ST"): Result {
  const root = mkdtempSync(join(tmpdir(), "ci-"));
  const rawDir = join(root, "raw");
  const evidenceDir = join(root, "evidence");
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  if (csvContent !== null) {
    writeFileSync(join(evidenceDir, "pgss-full.csv"), csvContent, "utf8");
  }
  const p = spawnSync("python3", [SCRIPT, rawDir, evidenceDir, arm, CLAIM_SIG, CORR_SIG], {
    encoding: "utf8",
  });
  expect(p.status).toBe(0);
  const out = readFileSync(join(rawDir, "claim-inventory.json"), "utf8");
  rmSync(root, { recursive: true, force: true });
  return JSON.parse(out) as Result;
}

const header = "calls,total_ms,mean_ms,stddev_ms,max_ms,rows,query\n";
const claimRow = (calls: number) => `${calls},1000.0,0.5,0.1,10.0,${calls},"${CLAIM_SIG}"\n`;
const corrRow = (calls: number) => `${calls},500.0,0.3,0.1,5.0,${calls},"${CORR_SIG}"\n`;
const noiseRow = "2,10.0,1.0,0.0,2.0,2,select 1\n";

describe("claim-inventory.py — عقدُ القراءةِ", () => {
  test("CSV سليم؛ claims حاضر وcorrelation غائب ⇒ claims موجب وcorrelation صفرٌ رقميّ (رحلةٌ واحدة)", () => {
    const r = runCollector(header + claimRow(31175) + noiseRow);
    expect(r.arm).toBe("ST");
    expect(r.claims).toBe(31175);
    expect(r.correlation).toBe(0);
    expect(r.queriesPerClaim).toBe(0);
  });

  test("CSV سليم (CUR)؛ كلا الاستعلامينِ حاضر ⇒ العدّانِ ملتقطانِ والضابطُ الموجبُ يمرّ", () => {
    const r = runCollector(header + claimRow(50000) + corrRow(24000) + noiseRow, "CUR");
    expect(r.claims).toBe(50000);
    expect(r.correlation).toBe(24000);
    expect(r.queriesPerClaim).toBe(0.48);
  });

  test("ST بارتباطٍ موجبٍ ⇒ الجردُ يُخرجُ الرقمَ ففحصُ الصفرِ يسقطُه (ذراعٌ لم يُسقطِ الاستعلامَ الثاني)", () => {
    const r = runCollector(header + claimRow(1000) + corrRow(400));
    expect(r.claims).toBe(1000);
    expect(r.correlation).toBe(400);
    expect((r.correlation ?? 1) === 0).toBe(false);
  });

  test("CUR بلا ارتباطٍ ⇒ الضابطُ الموجبُ يسقطُه (claims وحدها لا تكفي)", () => {
    const r = runCollector(header + claimRow(1000), "CUR");
    expect(r.claims).toBe(1000);
    expect(r.correlation).toBe(0);
    expect((r.correlation ?? 0) > 0).toBe(false);
  });

  test("الملفُّ غائبٌ ⇒ null فلا يمرُّ فحصٌ (الغائبُ ليسَ صفرًا)", () => {
    const r = runCollector(null);
    expect(r.claims).toBeNull();
    expect(r.correlation).toBeNull();
    expect(r.queriesPerClaim).toBeNull();
  });

  test("قراءةٌ تفشلُ بعدَ صفِّ claims (ملفٌّ مبتور) ⇒ null لا أرقامٌ جزئيّةٌ ولا صفرٌ مصنوع", () => {
    // ملفٌّ يبدأُ سليمًا (صفُّ claims يُقرأُ) ثم ينقطعُ قبلَ إتمامِ التحليلِ.
    const truncated = header + claimRow(100);
    const root = mkdtempSync(join(tmpdir(), "ci-"));
    const rawDir = join(root, "raw");
    const evidenceDir = join(root, "evidence");
    mkdirSync(rawDir, { recursive: true });
    mkdirSync(evidenceDir, { recursive: true });
    const path = join(evidenceDir, "pgss-full.csv");
    writeFileSync(path, truncated, "utf8");
    // نصنعُ فشلَ تحليلٍ بعدَ قراءةِ صفِّ claims: قيمةُ calls غيرُ رقميّةٍ في صفٍّ لاحقٍ.
    writeFileSync(path, `${truncated}abc,1.0,1.0,1.0,1.0,1,${CORR_SIG}\n`, "utf8");
    const p = spawnSync("python3", [SCRIPT, rawDir, evidenceDir, "ST", CLAIM_SIG, CORR_SIG], {
      encoding: "utf8",
    });
    expect(p.status).toBe(0);
    const out = JSON.parse(readFileSync(join(rawDir, "claim-inventory.json"), "utf8")) as Result;
    rmSync(root, { recursive: true, force: true });
    expect(out.claims).toBeNull();
    expect(out.correlation).toBeNull();
  });

  test("صفٌّ مبتورٌ غاب عنهُ query بعدَ صفِّ claims صالحٍ ⇒ null (لا صفرٌ مصنوعٌ من غيابِ الاستعلامِ)", () => {
    // الصفُّ الثاني ناقصُ العمودِ الأخيرِ (query) — يجبُ أن يُرفضَ الملفُّ كاملًا
    // لا أن يُتجاهلَ الصفُّ فيبقى claims موجبًا مع correlation=0 مصنوعٍ.
    const csv = `${header}${claimRow(100)}5,1.0,1.0,1.0,1.0,5\n`;
    const r = runCollector(csv);
    expect(r.claims).toBeNull();
    expect(r.correlation).toBeNull();
  });

  test("بنيةٌ تالفةٌ (صفٌّ بأعمدةٍ زائدةٍ غيرُ متوقّعةٍ) ⇒ null لا أرقامٌ جزئيّةٌ", () => {
    // صفٌّ بأعمدةٍ زائدةٍ (restkey) — بنيةٌ لا يفترضها الملفُ السليمُ، فتُرفضُ
    // قراءتُها كاملةً لا أن تُتجاهلَ فيبقى claims موجبًا مع correlation=0 مصنوعٍ.
    const csv = `${header}${claimRow(100)}7,1.0,1.0,1.0,1.0,7,extra1,extra2\n`;
    const r = runCollector(csv);
    expect(r.claims).toBeNull();
    expect(r.correlation).toBeNull();
  });

  test("calls سالبٌ أو غيرُ صحيحٍ ⇒ null", () => {
    const r = runCollector(`${header}${claimRow(50)}-3,1.0,1.0,1.0,1.0,3,${CORR_SIG}\n`);
    expect(r.claims).toBeNull();
    expect(r.correlation).toBeNull();
  });
});
