#!/usr/bin/env bun
/**
 * الغرض: **حاجزٌ يمنعُ سنداً يكذبُ**: إن تغيَّرَت بايتاتُ ملفٍّ منقولٍ في مدى
 *    الدفعِ، فَلْيتغيَّرْ سطرُ سندِه في المدى نفسِه. البند `DEP-CORE-005`
 *    (الزيادةُ الثانيةُ).
 * الحالة: منفّذ فعلياً — 2026-09-12 · البند `DEP-CORE-005`.
 * ينتمي إلى: scripts
 * يُستخدم من: `.github/workflows/roadmap.yml` (وهيَ الجريَةُ التي تملكُ مدىً
 *    حقيقيّاً و`fetch-depth: 0`) و`tests/unit/vendored-pin-follows-bytes.test.ts`.
 * ملاحظات مستقبلية: حينَ تُمنَحُ `O-6` يصيرُ `check-core-contract-freshness.ts`
 *    قادراً على كشفِ السندِ الكاذبِ من CORE نفسِه؛ ويبقى هذا الحاجزُ نافعاً لأنَّه
 *    يحكمُ **بلا شبكةٍ** وفي اللحظةِ التي يُكتَبُ فيها الخطأُ لا بعدَ ساعاتٍ.
 *
 * ## الثقبُ الذي يسدُّه — وقد قِيسَ لا افتُرِضَ
 *
 * بعدَ الزيادةِ الأولى صارَ لكلِّ ملفٍّ منقولٍ سطرُ سندٍ يقولُ: من أيِّ مستودَعٍ،
 * وعندَ أيِّ التزامٍ، ومن أيِّ مسارٍ. وحاجزُ السلامةِ يُعيدُ حسابَ البصماتِ، فلا
 * تُحرَّرُ نسخةٌ بعدَ نقلِها. ومع ذلكَ بقيَ طريقٌ واحدٌ إلى سجلٍّ كاذبٍ لا يكشفُه
 * أحدٌ: **إعادةُ نقلٍ صادقةٌ تُحدِّثُ البايتاتَ والبصمةَ وتنسى السندَ**. فتصيرُ
 * النسخةُ من التزامٍ، والسندُ يقولُ التزاماً آخرَ، والحاجزانِ أخضرانِ: هذا
 * يُقابِلُ البصمةَ بالملفِّ، وذاكَ يُقابِلُ الملفَّ بالسندِ وجوداً لا مضموناً.
 *
 * وليسَ هذا احتمالاً نظريّاً: طلبُ الدمجِ `#11` يُعيدُ نقلَ ثلاثةِ عقودٍ، وسندُ
 * هذا الفرعِ يُثبِّتُها عندَ التزاماتِ `main`. فأيُّهما دُمِجَ ثانياً، لزمَ أن
 * يُحدِّثَ السندَ — وقبلَ هذا الحاجزِ لم يكن في المستودَعِ ما يُلزِمُه.
 *
 * ## ولِمَ لا تُكتَبُ بصمةُ المصدرِ في سطرِ السندِ
 *
 * لأنَّ ذاكَ يبدو أقوى وهوَ أضعفُ: بصمةُ نسختِنا موضعُها الواحدُ في جدولِ
 * البصماتِ، وتكرارُها في السندِ يُنشئُ مصدرَ حقيقةٍ ثانياً ينحرفُ ولا يُكشَفُ —
 * وهوَ ما رفضَه `ADR 0090` صراحةً. فالحُكمُ ههنا على **التزامنِ في المدى** لا
 * على قيمةٍ مُكرَّرةٍ: السندُ يُجيبُ «من أينَ؟»، والبصمةُ «هل تغيَّرَ؟»، وهذا
 * الحاجزُ «هل تغيَّرا معاً؟».
 *
 * ## ولِمَ في جريَةِ الخارطةِ لا في `verify`
 *
 * لأنَّه حاجزُ **مدىً**: لا يُحكَمُ به على شجرةٍ ساكنةٍ بل على ما بينَ التزامَينِ،
 * وجريَةُ `Roadmap freshness` وحدَها تملكُ `fetch-depth: 0` ومدى الدفعِ. ولو
 * أُدرِجَ في `verify` لاحتاجَ تاريخاً كاملاً في كلِّ جريَةٍ، أو لسكتَ سكوتاً
 * دائماً — وحاجزٌ ساكتٌ أسوأُ من غيابِه لأنَّه يُقرأُ إنفاذاً.
 */

import { execFileSync } from "node:child_process";
import { CONTRACTS_DIR, PIN_LINE, PROVENANCE_NAME } from "./lib/vendored-contract-pins.ts";

/** صفرٌ أربعونَ خانةً: ما يُرسِلُه GitHub عندَ أوّلِ دفعٍ لفرعٍ جديدٍ. */
const ZERO_SHA = "0".repeat(40);

export interface RangeChanges {
  /** مساراتٌ نسبيّةٌ داخلَ `docs/contracts/core` تغيَّرَت بايتاتُها في المدى. */
  readonly changedVendored: readonly string[];
  /** المساراتُ المنقولةُ التي تغيَّرَ سطرُ سندِها في المدى (إضافةً أو حذفاً). */
  readonly pinsChangedFor: readonly string[];
}

/**
 * الحُكمُ — دالّةٌ خالصةٌ: تُرجِعُ الخروقَ ولا تطبعُ ولا تُخرِجُ العمليّةَ، فتُقاسُ
 * بمدىً مزروعٍ بلا `git` ولا شبكةٍ.
 */
export function judgeRange(changes: RangeChanges): readonly string[] {
  const pinned = new Set(changes.pinsChangedFor);
  const breaches: string[] = [];
  for (const rel of changes.changedVendored) {
    if (pinned.has(rel)) continue;
    breaches.push(
      `${rel}: تغيَّرَت بايتاتُه في هذا المدى ولم يتغيَّرْ سطرُ سندِه — فالسندُ يشيرُ إلى التزامٍ لم تُنقَلْ منهُ هذه النسخةُ. يُحدَّثُ سطرُ \`pin\` في \`${CONTRACTS_DIR}/${PROVENANCE_NAME}\` في الالتزامِ نفسِه.`,
    );
  }
  return breaches;
}

/** أسطُرُ السندِ التي دخلَت أو خرجَت في مدىً من نصِّ `git diff` للسجلِّ وحدَه. */
export function pinPathsTouchedInDiff(unifiedDiff: string): readonly string[] {
  const touched = new Set<string>();
  for (const line of unifiedDiff.split("\n")) {
    if (!(line.startsWith("+") || line.startsWith("-"))) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    const pin = PIN_LINE.exec(line.slice(1).trim());
    if (pin === null) continue;
    const vendoredPath = pin[4];
    if (vendoredPath !== undefined) touched.add(vendoredPath);
  }
  return [...touched].sort();
}

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", args as string[], { cwd, encoding: "utf8" });
}

/** قراءةُ المدى من `git` — تُفصَلُ عن الحكمِ ليُقاسَ الحكمُ بلا مستودَعٍ. */
export function readRange(base: string, head: string, cwd: string = process.cwd()): RangeChanges {
  const names = git(["diff", "--name-only", base, head, "--", CONTRACTS_DIR], cwd);
  const provenancePath = `${CONTRACTS_DIR}/${PROVENANCE_NAME}`;
  const changedVendored = names
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== provenancePath)
    .map((l) => l.slice(`${CONTRACTS_DIR}/`.length))
    .sort();

  const diff = git(["diff", "-U0", base, head, "--", provenancePath], cwd);
  return { changedVendored, pinsChangedFor: pinPathsTouchedInDiff(diff) };
}

/**
 * حلُّ المدى: ما يُعطيهِ الدفعُ أوّلاً، ثمَّ أصلُ الفرعِ من `main`. ولا يُسكَتُ
 * حينَ يتعذَّرُ الحلُّ: يُخرَجُ بـ`3` ويُسمّى السببُ، فلا يُقرأُ تعذُّرٌ نجاحاً.
 */
function resolveRange(cwd: string): { base: string; head: string } | string {
  const argBase = process.argv[2];
  const argHead = process.argv[3];
  if (argBase !== undefined && argHead !== undefined) return { base: argBase, head: argHead };

  const head = process.env.HEAD_SHA?.trim() || "HEAD";
  const envBase = process.env.BASE_SHA?.trim();
  if (envBase !== undefined && envBase.length > 0 && envBase !== ZERO_SHA) {
    try {
      git(["rev-parse", "--verify", `${envBase}^{commit}`], cwd);
      return { base: envBase, head };
    } catch {
      /* يُجرَّبُ أصلُ الفرعِ */
    }
  }

  for (const ref of ["origin/main", "main"]) {
    try {
      const base = git(["merge-base", ref, head], cwd).trim();
      if (base.length > 0) return { base, head };
    } catch {
      /* يُجرَّبُ التالي */
    }
  }

  return "لا مدى يُحَلُّ: لا `BASE_SHA` صالحٌ ولا أصلٌ من `main` (نسخةٌ ضحلةٌ؟ يُضبَطُ `fetch-depth: 0`).";
}

function main(): void {
  const cwd = process.cwd();
  const range = resolveRange(cwd);
  if (typeof range === "string") {
    console.error(`سندُ العقودِ يتبعُ بايتاتِها: **غيرُ قابلٍ للتحقُّقِ** — ولا دعوى تُطبَعُ.`);
    console.error(`  السببُ: ${range}`);
    console.error(`  المخرَجُ 3: ليسَ نجاحاً، وليسَ تخطّياً، وليسَ فشلَ انحرافٍ.`);
    process.exit(3);
  }

  const changes = readRange(range.base, range.head, cwd);
  if (changes.changedVendored.length === 0) {
    console.log(
      `سندُ العقودِ يتبعُ بايتاتِها: لا ملفَّ منقولاً تغيَّرَ في ${range.base.slice(0, 7)}..${range.head.slice(0, 7)} — فلا سندَ يلزمُ تحديثُه.`,
    );
    return;
  }

  const breaches = judgeRange(changes);
  if (breaches.length > 0) {
    console.error("سندُ العقودِ لا يتبعُ بايتاتِها — إعادةُ نقلٍ بلا تحديثِ سندٍ:");
    for (const breach of breaches) console.error(`  - ${breach}`);
    console.error(
      "\nوليسَ العلاجُ تخفيفَ الحاجزِ: نسخةٌ من التزامٍ وسندٌ يقولُ التزاماً آخرَ سجلٌّ كاذبٌ، وكلُّ مقابلةٍ تالية تُبنى عليه.",
    );
    process.exit(1);
  }

  console.log(
    `سندُ العقودِ يتبعُ بايتاتِها: نجح — ${changes.changedVendored.length} ملفّاً منقولاً تغيَّرَ، ولكلٍّ سطرُ سندٍ تغيَّرَ معهُ في المدى نفسِه.`,
  );
}

if (import.meta.main) main();
