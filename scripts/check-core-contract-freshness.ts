#!/usr/bin/env bun
/**
 * الغرض: **مُقابِلُ طزاجةٍ** بينَ العقودِ المنقولةِ في هذا المستودَعِ ومصدرِها
 *    عندَ CORE: لكلِّ ملفٍّ مُثبَّتٍ تُقرأُ بايتاتُه عندَ التزامِ التثبيتِ وعندَ
 *    رأسِ CORE، فيُحكَمُ: مطابقٌ، أم نسختُنا مُحرَّرةٌ، أم المصدرُ تقدَّمَ
 *    (بائتٌ)، أم المصدرُ أُزيلَ. والاختلافُ يُعرَضُ **دلاليّاً** مُصنَّفاً.
 *    البند `DEP-CORE-005`.
 * الحالة: منفّذ فعلياً — 2026-09-12 · البند `DEP-CORE-005`.
 * ينتمي إلى: scripts (وليسَ في سلسلةِ `ci`: لا يُقاسُ ما لا مصدرَ له — انظر أدناه)
 * يُستخدم من: `package.json` → `check:core-contract-freshness`، و
 *    `.github/workflows/core-contract-freshness.yml` بالطلبِ اليدويِّ وحدَه.
 * ملاحظات مستقبلية: حينَ تُمنَحُ `O-6` يُنقَلُ هذا إلى `verify` خطوةً مُسمَّاةً
 *    ويصيرُ حاجزاً مُنفِذاً، وعندَها وحدَها تُقفَلُ `DEP-CORE-005`.
 *
 * ## مصدرُ البايتاتِ: نسخةٌ محلّيّةٌ من CORE، ولا سرَّ ولا شبكةَ
 *
 * لا يقرأُ هذا المُقابِلُ شبكةً ولا يحملُ رِمزاً ولا يقرأُ متغيِّرَ بيئةٍ سرّيّاً:
 * يُعطى **مسارَ نسخةٍ محلّيّةٍ** من مستودَعِ CORE (`--from-dir=` أو
 * `CORE_CONTRACTS_REPO_DIR`) ويقرأُ منها بـ`git show`. وذلكَ مقصودٌ: التعليمةُ
 * تطلبُ ألّا يتطلَّبَ الفحصُ أسراراً ولا بيئةَ نشرٍ خارجيّةً إن أمكنَ. فمن
 * يملكُ الوصولَ — المالِكُ على حاسبِه، أو جريَةٌ أُعطيَت نسخةً — يُشغِّلُه بلا
 * أن يُودَعَ في المستودَعِ سرٌّ ألبتّةَ.
 *
 * ## ولِمَ لا يمرُّ أخضرَ حينَ لا مصدرَ
 *
 * فحصٌ يخرجُ بصفرٍ حينَ لا يجدُ CORE يُعلِّمُ القارئَ أنَّ الطزاجةَ مُثبَتةٌ وهيَ
 * غيرُ مقيسةٍ، وذاكَ كذبٌ آليٌّ أسوأُ من غيابِ الفحصِ. فالمخرَجُ ههنا ثلاثةٌ:
 *   - `0` كلُّ مُثبَّتٍ مطابقٌ لمصدرِه عندَ رأسِ CORE؛
 *   - `1` انحرافٌ مقيسٌ (بائتٌ، أو نسختُنا مُحرَّرةٌ، أو المصدرُ أُزيلَ)؛
 *   - `3` **غيرُ قابلٍ للتحقُّقِ**: لا نسخةَ من CORE — ولا تُطبَعُ دعوى طزاجةٍ.
 * والمخرَجُ `3` ليسَ نجاحاً ولا يُعَدُّ تخطّياً؛ وهوَ سببُ بقاءِ
 * `DEP-CORE-005` مفتوحةً ما بقيَت `O-6` مفتوحةً.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  diffContractText,
  hasExecutableChange,
  type SemanticChange,
} from "./lib/schema-semantic-diff.ts";
import {
  CONTRACTS_DIR,
  type ContractPin,
  listVendored,
  readProvenance,
  sha256OfBytes,
} from "./lib/vendored-contract-pins.ts";

export type Verdict = "current" | "stale" | "copy_edited" | "source_removed" | "pin_unreadable";

export interface FileOutcome {
  readonly vendoredPath: string;
  readonly pin: ContractPin;
  readonly verdict: Verdict;
  readonly detail: string;
  readonly changes: readonly SemanticChange[];
  readonly claim: string;
}

export interface GitReader {
  /** بايتاتُ مسارٍ عندَ مرجعٍ، أو `null` إن لم يوجدْ هناكَ. */
  show(ref: string, path: string): string | null;
  /** رأسُ المستودَعِ كاملاً. */
  head(): string;
}

/** قارئٌ حقيقيٌّ فوقَ `git` — يُبدَّلُ بمزروعٍ في الاختبارِ. */
export function gitReaderFor(dir: string): GitReader {
  const run = (args: readonly string[]): { ok: boolean; out: string } => {
    const result = Bun.spawnSync(["git", "-C", dir, ...args], { stderr: "pipe" });
    return { ok: result.exitCode === 0, out: new TextDecoder().decode(result.stdout) };
  };
  return {
    show(ref, path) {
      const result = run(["show", `${ref}:${path}`]);
      return result.ok ? result.out : null;
    },
    head() {
      const result = run(["rev-parse", "HEAD"]);
      if (!result.ok) throw new Error(`ليسَ مستودَعَ git صالحاً: ${dir}`);
      return result.out.trim();
    },
  };
}

/**
 * الحكمُ على ملفٍّ واحدٍ. دالّةٌ خالصةٌ في قارئِها فتُقاسُ بمستودَعٍ مزروعٍ.
 *
 * وترتيبُ الأحكامِ مقصودٌ: يُسألُ أوّلاً هل نسختُنا **هيَ** بايتاتُ المصدرِ عندَ
 * التزامِ التثبيتِ. فإن لم تكنْ فالسندُ نفسُه كاذبٌ (`copy_edited`) ولا معنى
 * لسؤالِ الطزاجةِ بعدَه: لا يُقارَنُ بالرأسِ ما لم يُثبَتْ أصلُه.
 */
export function judgeFile(
  pin: ContractPin,
  ourText: string,
  reader: GitReader,
  coreHead: string,
): FileOutcome {
  const base = { vendoredPath: pin.vendoredPath, pin };

  const atPin = reader.show(pin.commit, pin.sourcePath);
  if (atPin === null) {
    return {
      ...base,
      verdict: "pin_unreadable",
      detail: `لا يُقرأُ \`${pin.sourcePath}\` عندَ \`${pin.commit.slice(0, 7)}\` — إمّا التزامٌ غيرُ موجودٍ في هذه النسخةِ وإمّا مسارٌ خاطئٌ في السندِ`,
      changes: [],
      claim: "لا مقابلةَ",
    };
  }

  if (sha256OfBytes(atPin) !== sha256OfBytes(ourText)) {
    const diff = diffContractText(pin.vendoredPath, atPin, ourText);
    return {
      ...base,
      verdict: "copy_edited",
      detail:
        "نسختُنا لا تطابقُ بايتاتِ المصدرِ عندَ التزامِ التثبيتِ — فالعقدُ أُلِّفَ أو حُرِّرَ بعدَ النقلِ، والعقودُ تُنقَلُ بايتاً بايتاً ولا تُؤلَّفُ",
      changes: diff.changes,
      claim: diff.claim,
    };
  }

  const atHead = reader.show(coreHead, pin.sourcePath);
  if (atHead === null) {
    return {
      ...base,
      verdict: "source_removed",
      detail: `\`${pin.sourcePath}\` لم يبقَ عندَ رأسِ CORE (\`${coreHead.slice(0, 7)}\`) — نُقِلَ أو أُزيلَ، فالسندُ يشيرُ إلى ما لا يُصانُ`,
      changes: [],
      claim: "لا مقابلةَ",
    };
  }

  if (sha256OfBytes(atHead) === sha256OfBytes(atPin)) {
    return {
      ...base,
      verdict: "current",
      detail: `مطابقٌ لرأسِ CORE (\`${coreHead.slice(0, 7)}\`)`,
      changes: [],
      claim: "تطابقُ بايتاتٍ — أقوى من التكافؤِ الدلاليِّ",
    };
  }

  const diff = diffContractText(pin.vendoredPath, atPin, atHead);
  if (!hasExecutableChange(diff.changes)) {
    return {
      ...base,
      verdict: "stale",
      detail:
        "المصدرُ تقدَّمَ، والاختلافُ كلُّه وصفيٌّ لا يُنفَّذُ — يُعادُ النقلُ لتصحيحِ السندِ ولا يُتوقَّعُ عطبُ سلوكٍ",
      changes: diff.changes,
      claim: diff.claim,
    };
  }
  return {
    ...base,
    verdict: "stale",
    detail: `المصدرُ تقدَّمَ عندَ رأسِ CORE (\`${coreHead.slice(0, 7)}\`) بتغييرٍ **يُنفَّذُ**`,
    changes: diff.changes,
    claim: diff.claim,
  };
}

const SEVERITY_LABEL: Record<SemanticChange["severity"], string> = {
  breaking_for_consumer: "يكسِرُ المستهلكَ",
  breaking_for_producer: "يكسِرُ المنتِجَ",
  additive: "زيادةٌ",
  structural: "بنيةٌ",
  editorial: "وصفٌ",
};

const VERDICT_LABEL: Record<Verdict, string> = {
  current: "مطابقٌ",
  stale: "بائتٌ",
  copy_edited: "نسختُنا مُحرَّرةٌ",
  source_removed: "المصدرُ أُزيلَ",
  pin_unreadable: "سندٌ لا يُقرأُ",
};

function resolveSourceDir(argv: readonly string[]): string | null {
  const flag = argv.find((arg) => arg.startsWith("--from-dir="));
  const dir = flag?.slice("--from-dir=".length) ?? process.env.CORE_CONTRACTS_REPO_DIR ?? "";
  if (dir.trim() === "") return null;
  return dir.trim();
}

function main(argv: readonly string[]): never {
  const dir = resolveSourceDir(argv);
  if (dir === null) {
    console.error("طزاجةُ العقودِ المنقولةِ: **غيرُ قابلةٍ للتحقُّقِ** — ولا دعوى تُطبَعُ.");
    console.error(
      "  السببُ: لا نسخةَ من مستودَعِ CORE تُقرأُ. يُمرَّرُ `--from-dir=<مسارٌ>` أو يُضبَطُ `CORE_CONTRACTS_REPO_DIR`.",
    );
    console.error(
      "  ولِمَ لا تُعطاها CI: `uxxxug/wasla-core` مستودَعٌ خاصٌّ ورِمزُ جرياتِ هذا المستودَعِ لا يقرؤُه — وذاكَ `O-6` في `ROADMAP.md`، قرارُ مالِكٍ لا شغلُ وكيلٍ.",
    );
    console.error("  المخرَجُ 3: ليسَ نجاحاً، وليسَ تخطّياً، وليسَ فشلَ انحرافٍ.");
    process.exit(3);
  }
  if (!existsSync(join(dir, ".git"))) {
    console.error(`طزاجةُ العقودِ المنقولةِ: \`${dir}\` ليسَ نسخةَ git من CORE.`);
    process.exit(3);
  }

  const reader = gitReaderFor(dir);
  const coreHead = reader.head();
  const { pins } = readProvenance();
  const vendored = listVendored(CONTRACTS_DIR);

  const outcomes: FileOutcome[] = [];
  for (const rel of vendored) {
    const pin = pins.get(rel);
    if (pin === undefined) {
      console.error(
        `${rel}: ملفٌّ منقولٌ بلا سندٍ — يُصلَحُ بـ\`bun run check:vendored-contract-pins\` قبلَ قياسِ الطزاجةِ`,
      );
      process.exit(1);
    }
    outcomes.push(judgeFile(pin, readFileSync(join(CONTRACTS_DIR, rel), "utf8"), reader, coreHead));
  }

  console.log(`مصدرُ المقابلةِ: \`${dir}\` عندَ رأسٍ \`${coreHead}\`.`);
  console.log(`العقودُ المُثبَّتةُ: ${outcomes.length}.\n`);

  for (const outcome of outcomes) {
    const mark = outcome.verdict === "current" ? "✔" : "✘";
    console.log(
      `${mark} ${outcome.vendoredPath} — ${VERDICT_LABEL[outcome.verdict]}\n` +
        `    المصدرُ: ${outcome.pin.repo}:${outcome.pin.sourcePath} @ ${outcome.pin.commit.slice(0, 7)}\n` +
        `    ${outcome.detail}\n    حدُّ الدعوى: ${outcome.claim}`,
    );
    for (const change of outcome.changes.slice(0, 24)) {
      console.log(
        `      · [${SEVERITY_LABEL[change.severity]}] ${change.at}: ${change.why}\n` +
          `          قبلَ: ${change.before}\n          بعدَ: ${change.after}`,
      );
    }
    if (outcome.changes.length > 24) {
      console.log(`      · (و${outcome.changes.length - 24} اختلافاً آخرَ)`);
    }
  }

  const unvendored = (() => {
    const result = Bun.spawnSync(["git", "-C", dir, "ls-tree", "-r", "--name-only", coreHead], {
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return [];
    const sourcePaths = new Set([...pins.values()].map((pin) => pin.sourcePath));
    return new TextDecoder()
      .decode(result.stdout)
      .split("\n")
      .filter((path) => path.endsWith(".schema.json") && !sourcePaths.has(path));
  })();
  if (unvendored.length > 0) {
    console.log(
      `\nإخباراً لا حكماً: عندَ رأسِ CORE ${unvendored.length} مخطَّطاً لا يَنقُلُه MOVE — ` +
        "وذاكَ صحيحٌ ما لم يستهلِكْ MOVE تلكَ العائلاتِ؛ يُقرأُ ليُعلَمَ ما نمتنعُ عنه عن قصدٍ:",
    );
    for (const path of unvendored.slice(0, 30)) console.log(`  - ${path}`);
    if (unvendored.length > 30) console.log(`  - (و${unvendored.length - 30} غيرَها)`);
  }

  const drifted = outcomes.filter((outcome) => outcome.verdict !== "current");
  if (drifted.length > 0) {
    console.error(
      `\nطزاجةُ العقودِ المنقولةِ: أخفقَت — ${drifted.length} من ${outcomes.length} منحرفٌ:`,
    );
    for (const outcome of drifted) {
      console.error(`  - ${outcome.vendoredPath}: ${VERDICT_LABEL[outcome.verdict]}`);
    }
    console.error(
      "  والإصلاحُ إعادةُ نقلِ البايتاتِ وتصحيحُ السندِ ومقابلةُ الإعلانِ بها — لا تعديلُ الحاجزِ.",
    );
    process.exit(1);
  }
  console.log("\nطزاجةُ العقودِ المنقولةِ: كلُّ مُثبَّتٍ يطابقُ مصدرَه عندَ رأسِ CORE المقروءِ.");
  process.exit(0);
}

if (import.meta.main) main(process.argv.slice(2));
