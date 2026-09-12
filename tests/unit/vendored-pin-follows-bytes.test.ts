/**
 * الغرض: قياسُ الحاجزِ الذي يمنعُ **سنداً يكذبُ**: إعادةُ نقلٍ تُحدِّثُ البايتاتَ
 *    وتنسى سطرَ السندِ. البند `DEP-CORE-005` (الزيادةُ الثانيةُ).
 * الحالة: منفّذ فعلياً — 2026-09-12.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وخطوةُ `verify` المُسمَّاةُ في `.github/workflows/ci.yml`.
 * ملاحظات مستقبلية: لو صارَ السجلُّ مُهيكلاً، بقيَ هذا القياسُ كما هوَ لأنَّه
 *    يقيسُ **التزامنَ** لا الصيغةَ.
 *
 * وسقوطُ الحاجزِ يُقاسُ ههنا بخرقٍ مزروعٍ في مستودَعِ `git` حقيقيٍّ صغيرٍ، فلا
 * يحتاجُ القياسُ شبكةً ولا صلاحيّةً ولا نسخةً من CORE: يُقاسُ في CI وعلى حاسبِ
 * غيرِ المالكِ سواءً.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  judgeRange,
  pinPathsTouchedInDiff,
  readRange,
} from "../../scripts/check-vendored-pin-follows-bytes.ts";

const CONTRACTS = "docs/contracts/core";
const PROVENANCE = `${CONTRACTS}/PROVENANCE.md`;
const REPO = "uxxxug/wasla-core";
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", args as string[], { cwd, encoding: "utf8" });
}

function provenanceText(commit: string, extra = ""): string {
  return [
    "# سندُ العقودِ المنقولةِ",
    "",
    `pin ${REPO} ${commit} contracts/events/core.fulfillment.cancelled.v1.schema.json -> core.fulfillment.cancelled.v1.schema.json`,
    `pin ${REPO} ${COMMIT_A} contracts/events/envelope.schema.json -> envelope.schema.json`,
    extra,
    "",
  ].join("\n");
}

/** مستودَعٌ حقيقيٌّ بالتزامٍ أوّلٍ: عقدانِ منقولانِ وسجلٌّ يُثبِّتُهما. */
function seedRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pin-follows-"));
  temporaries.push(dir);
  git(["init", "-q", "-b", "main"], dir);
  git(["config", "user.email", "t@t.t"], dir);
  git(["config", "user.name", "t"], dir);
  mkdirSync(join(dir, CONTRACTS), { recursive: true });
  writeFileSync(join(dir, `${CONTRACTS}/core.fulfillment.cancelled.v1.schema.json`), '{"a":1}\n');
  writeFileSync(join(dir, `${CONTRACTS}/envelope.schema.json`), '{"e":1}\n');
  writeFileSync(join(dir, PROVENANCE), provenanceText(COMMIT_A));
  git(["add", "-A"], dir);
  git(["commit", "-qm", "seed"], dir);
  return dir;
}

describe("الحُكمُ — دالّةٌ خالصةٌ على مدىً مزروعٍ", () => {
  test("بايتاتٌ تغيَّرَت وسندٌ تغيَّرَ معها: لا خرقَ", () => {
    const breaches = judgeRange({
      changedVendored: ["core.fulfillment.cancelled.v1.schema.json"],
      pinsChangedFor: ["core.fulfillment.cancelled.v1.schema.json"],
    });
    expect(breaches).toEqual([]);
  });

  test("بايتاتٌ تغيَّرَت وسندٌ لم يتغيَّرْ: خرقٌ يُسمّي الملفَّ", () => {
    const breaches = judgeRange({
      changedVendored: ["core.fulfillment.cancelled.v1.schema.json"],
      pinsChangedFor: [],
    });
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toContain("core.fulfillment.cancelled.v1.schema.json");
    expect(breaches[0]).toContain("ولم يتغيَّرْ سطرُ سندِه");
  });

  test("سندُ ملفٍّ آخرَ لا يُجزئُ عن سندِ الملفِّ الذي تغيَّرَ", () => {
    const breaches = judgeRange({
      changedVendored: ["core.fulfillment.cancelled.v1.schema.json"],
      pinsChangedFor: ["envelope.schema.json"],
    });
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toContain("core.fulfillment.cancelled.v1.schema.json");
  });

  test("ملفّانِ تغيَّرا وسندُ أحدِهما فقط: خرقٌ واحدٌ لا خرقانِ ولا صمتٌ", () => {
    const breaches = judgeRange({
      changedVendored: ["a.json", "b.json"],
      pinsChangedFor: ["a.json"],
    });
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toContain("b.json");
  });

  test("سندٌ تغيَّرَ بلا بايتاتٍ: ليسَ خرقاً — إعادةُ تثبيتٍ إلى التزامٍ أحدثَ لم يُغيِّرِ الملفَّ", () => {
    expect(judgeRange({ changedVendored: [], pinsChangedFor: ["envelope.schema.json"] })).toEqual(
      [],
    );
  });
});

describe("تفكيكُ أسطُرِ السندِ من نصِّ الفرقِ", () => {
  test("يقرأُ المُضافَ والمحذوفَ ولا يقرأُ رأسَ الفرقِ", () => {
    const diff = [
      "--- a/docs/contracts/core/PROVENANCE.md",
      "+++ b/docs/contracts/core/PROVENANCE.md",
      `-pin ${REPO} ${COMMIT_A} contracts/events/x.json -> x.json`,
      `+pin ${REPO} ${COMMIT_B} contracts/events/x.json -> x.json`,
    ].join("\n");
    expect(pinPathsTouchedInDiff(diff)).toEqual(["x.json"]);
  });

  test("سطرُ بصمةٍ تغيَّرَ لا يُقرأُ سنداً تغيَّرَ — ولا يُجزئُ عنه", () => {
    const diff = [`+${"f".repeat(64)}  x.json`, `-${"e".repeat(64)}  x.json`].join("\n");
    expect(pinPathsTouchedInDiff(diff)).toEqual([]);
  });

  test("سطرٌ لم يتغيَّرْ في فرقٍ بسياقٍ لا يُقرأُ تغيُّراً", () => {
    const diff = [` pin ${REPO} ${COMMIT_A} contracts/events/x.json -> x.json`].join("\n");
    expect(pinPathsTouchedInDiff(diff)).toEqual([]);
  });
});

describe("القراءةُ من مستودَعِ git حقيقيٍّ", () => {
  test("إعادةُ نقلٍ مع تحديثِ السندِ تمرُّ", () => {
    const dir = seedRepo();
    const base = git(["rev-parse", "HEAD"], dir).trim();
    writeFileSync(join(dir, `${CONTRACTS}/core.fulfillment.cancelled.v1.schema.json`), '{"a":2}\n');
    writeFileSync(join(dir, PROVENANCE), provenanceText(COMMIT_B));
    git(["add", "-A"], dir);
    git(["commit", "-qm", "re-vendor with pin"], dir);

    const changes = readRange(base, "HEAD", dir);
    expect(changes.changedVendored).toEqual(["core.fulfillment.cancelled.v1.schema.json"]);
    expect(changes.pinsChangedFor).toEqual(["core.fulfillment.cancelled.v1.schema.json"]);
    expect(judgeRange(changes)).toEqual([]);
  });

  test("إعادةُ نقلٍ بلا تحديثِ السندِ تُسقِطُ الحاجزَ — وهوَ الثقبُ بعينِه", () => {
    const dir = seedRepo();
    const base = git(["rev-parse", "HEAD"], dir).trim();
    writeFileSync(join(dir, `${CONTRACTS}/core.fulfillment.cancelled.v1.schema.json`), '{"a":2}\n');
    git(["add", "-A"], dir);
    git(["commit", "-qm", "re-vendor, pin forgotten"], dir);

    const changes = readRange(base, "HEAD", dir);
    expect(changes.changedVendored).toEqual(["core.fulfillment.cancelled.v1.schema.json"]);
    expect(changes.pinsChangedFor).toEqual([]);
    expect(judgeRange(changes)).toHaveLength(1);
  });

  test("تحديثُ البصمةِ وحدَه لا يُنجي: البصمةُ ليست سنداً", () => {
    const dir = seedRepo();
    const base = git(["rev-parse", "HEAD"], dir).trim();
    writeFileSync(join(dir, `${CONTRACTS}/core.fulfillment.cancelled.v1.schema.json`), '{"a":2}\n');
    writeFileSync(
      join(dir, PROVENANCE),
      provenanceText(COMMIT_A, `${"c".repeat(64)}  core.fulfillment.cancelled.v1.schema.json`),
    );
    git(["add", "-A"], dir);
    git(["commit", "-qm", "re-vendor, fingerprint only"], dir);

    const changes = readRange(base, "HEAD", dir);
    expect(changes.pinsChangedFor).toEqual([]);
    expect(judgeRange(changes)).toHaveLength(1);
  });

  test("حذفُ ملفٍّ منقولٍ بلا حذفِ سندِه يُسقِطُ الحاجزَ كذلكَ", () => {
    const dir = seedRepo();
    const base = git(["rev-parse", "HEAD"], dir).trim();
    rmSync(join(dir, `${CONTRACTS}/envelope.schema.json`));
    git(["add", "-A"], dir);
    git(["commit", "-qm", "drop vendored file"], dir);

    const changes = readRange(base, "HEAD", dir);
    expect(changes.changedVendored).toEqual(["envelope.schema.json"]);
    expect(judgeRange(changes)).toHaveLength(1);
  });

  test("تعديلُ السجلِّ وحدَه — نثراً — لا يُقرأُ تغيُّرَ ملفٍّ منقولٍ فلا يُطالَبُ بسندٍ", () => {
    const dir = seedRepo();
    const base = git(["rev-parse", "HEAD"], dir).trim();
    writeFileSync(join(dir, PROVENANCE), `${provenanceText(COMMIT_A)}\nفقرةٌ مُضافةٌ نثراً.\n`);
    git(["add", "-A"], dir);
    git(["commit", "-qm", "prose only"], dir);

    const changes = readRange(base, "HEAD", dir);
    expect(changes.changedVendored).toEqual([]);
    expect(judgeRange(changes)).toEqual([]);
  });

  test("مدىً بلا مساسٍ بالعقودِ أصلاً: لا خرقَ ولا دعوى", () => {
    const dir = seedRepo();
    const base = git(["rev-parse", "HEAD"], dir).trim();
    writeFileSync(join(dir, "README.md"), "x\n");
    git(["add", "-A"], dir);
    git(["commit", "-qm", "unrelated"], dir);

    const changes = readRange(base, "HEAD", dir);
    expect(changes.changedVendored).toEqual([]);
    expect(changes.pinsChangedFor).toEqual([]);
    expect(judgeRange(changes)).toEqual([]);
  });
});
