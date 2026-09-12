/**
 * الغرض: **قارئٌ واحدٌ لسجلِّ العقودِ المنقولةِ** في
 *    `docs/contracts/core/PROVENANCE.md`: البصماتُ (`sha256` ← مسارٌ منقولٌ)
 *    و**التثبيتاتُ** (مستودَعٌ ← التزامٌ ← مسارُ المصدرِ ← المسارُ المنقولُ).
 *    البند `DEP-CORE-005`.
 * الحالة: منفّذ فعلياً — 2026-09-12 · البند `DEP-CORE-005`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-vendored-contract-integrity.ts` و
 *    `scripts/check-vendored-contract-pins.ts` و
 *    `scripts/check-core-contract-freshness.ts` والاختباراتُ.
 * ملاحظات مستقبلية: لو صارَ للسجلِّ صيغةٌ مُهيكلةٌ (JSON مثلاً) فَلْيُبدَّلْ
 *    التفكيكُ ههنا وحدَه؛ فالقارئُ واحدٌ والقارئونَ لا يعرفونَ الصيغةَ.
 *
 * ## لماذا قارئٌ واحدٌ لا قارئانِ
 *
 * السجلُّ مصدرُ حقيقةٍ واحدٌ، فإن قرأَه كلُّ حاجزٍ بتعبيرِه انحرفَ التفكيكانِ
 * انحرافاً لا يكشفُه أحدٌ: حاجزٌ يرى بصمةً وآخرُ لا يراها، فيمرُّ الملفُّ من
 * أحدِهما. ولذلك يُقرأُ ههنا مرّةً واحدةً، ويستوردُ الحاجزانِ القارئَ لا
 * التعبيرَ.
 *
 * ## ولماذا التثبيتُ لازمٌ أصلاً
 *
 * قبلَ هذا كانَ السجلُّ يذكرُ التزامَ المصدرِ **نثراً** («الالتزامُ: `511624b…`»،
 * «مسارُ المصدرِ: `contracts/events/`»)، وذلكَ يكفي إنساناً يُقابِلُ بيدِه ولا
 * يكفي آلةً: لا شيءَ يربطُ ملفّاً منقولاً بعينِه بمسارِه في CORE وبالالتزامِ
 * الذي نُقِلَ عندَه. فما لا يُفكَّكُ آليّاً لا يُقابَلُ آليّاً، وهذا أحدُ سببَي
 * بقاءِ `DEP-CORE-005` مفتوحةً (والسببُ الآخرُ صلاحيّةُ الوصولِ — `O-6`).
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const CONTRACTS_DIR = "docs/contracts/core";
export const PROVENANCE_NAME = "PROVENANCE.md";

/** السجلُّ نفسُه لا يُبصَمُ: بصمتُه فيه فتتغيَّرُ بتغيُّرِها، وذاكَ دورٌ لا يُقفَلُ. */
export const NOT_VENDORED: ReadonlySet<string> = new Set([PROVENANCE_NAME]);

/** سطرُ بصمةٍ: أربعٌ وستّونَ خانةً ستّعشريّةً، ثمَّ فراغٌ، ثمَّ مسارٌ نسبيٌّ. */
export const FINGERPRINT_LINE = /^([0-9a-f]{64})\s{1,2}(\S+)$/;

/**
 * سطرُ تثبيتٍ:
 *   `pin <owner>/<repo> <التزامٌ من أربعينَ خانةً> <مسارُ المصدرِ> -> <المسارُ المنقولُ>`
 * والبادئةُ `pin` مقصودةٌ: تمنعُ التقاطَ أسطُرِ النثرِ، وتجعلُ السجلَّ مقروءاً
 * للإنسانِ والآلةِ في ملفٍّ واحدٍ بلا سجلٍّ ثانٍ يُنسى تحديثُه.
 */
export const PIN_LINE = /^pin\s+(\S+)\s+([0-9a-f]{40})\s+(\S+)\s+->\s+(\S+)$/;

export interface ContractPin {
  /** المستودَعُ المالِكُ، بصيغةِ `owner/repo`. */
  readonly repo: string;
  /** التزامُ المصدرِ كاملاً — أربعونَ خانةً، فالمختصرُ يتصادمُ ولا يُثبِّتُ. */
  readonly commit: string;
  /** مسارُ الملفِّ داخلَ مستودَعِ المصدرِ. */
  readonly sourcePath: string;
  /** المسارُ النسبيُّ داخلَ `docs/contracts/core`. */
  readonly vendoredPath: string;
}

export interface ProvenanceRecord {
  readonly fingerprints: ReadonlyMap<string, string>;
  readonly pins: ReadonlyMap<string, ContractPin>;
  /** خروقُ التفكيكِ نفسِه: سطرٌ مكرَّرٌ أو مسارٌ خارجُ الحدِّ. */
  readonly parseBreaches: readonly string[];
}

/** يُرفَضُ الصعودُ والمسارُ المطلقُ: تثبيتٌ يُخرِجُنا من الشجرةِ ليسَ تثبيتاً. */
function pathEscapes(path: string): boolean {
  return path.startsWith("/") || path.split("/").includes("..");
}

/** تفكيكُ نصِّ السجلِّ — دالّةٌ خالصةٌ تُقاسُ بنصٍّ مزروعٍ بلا ملفّاتٍ. */
export function parseProvenance(text: string): ProvenanceRecord {
  const fingerprints = new Map<string, string>();
  const pins = new Map<string, ContractPin>();
  const parseBreaches: string[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();

    const pin = PIN_LINE.exec(line);
    if (pin !== null) {
      const [, repo, commit, sourcePath, vendoredPath] = pin;
      if (
        repo === undefined ||
        commit === undefined ||
        sourcePath === undefined ||
        vendoredPath === undefined
      ) {
        continue;
      }
      if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
        parseBreaches.push(`سطرُ تثبيتٍ لـ\`${vendoredPath}\`: \`${repo}\` ليسَ \`owner/repo\``);
        continue;
      }
      if (pathEscapes(sourcePath) || pathEscapes(vendoredPath)) {
        parseBreaches.push(`سطرُ تثبيتٍ لـ\`${vendoredPath}\`: مسارٌ يصعدُ أو مطلقٌ — لا يُقبَلُ في تثبيتٍ`);
        continue;
      }
      if (pins.has(vendoredPath)) {
        parseBreaches.push(
          `\`${vendoredPath}\`: تثبيتانِ لملفٍّ واحدٍ — أيُّهما النافذُ؟ يُترَكُ واحدٌ ويُنقَلُ الآخرُ إلى سجلِّ المُلغى`,
        );
        continue;
      }
      pins.set(vendoredPath, { repo, commit, sourcePath, vendoredPath });
      continue;
    }

    const fingerprint = FINGERPRINT_LINE.exec(line);
    if (fingerprint === null) continue;
    const [, digest, path] = fingerprint;
    if (digest === undefined || path === undefined) continue;
    if (fingerprints.has(path) && fingerprints.get(path) !== digest) {
      parseBreaches.push(
        `\`${path}\`: بصمتانِ نافذتانِ مختلفتانِ — الدليلُ المُلغى يُنقَلُ إلى جدولٍ لا يُقرأُ سطراً نافذاً`,
      );
      continue;
    }
    fingerprints.set(path, digest);
  }

  return { fingerprints, pins, parseBreaches };
}

/** قراءةُ السجلِّ من جذرِ العقودِ المنقولةِ. */
export function readProvenance(root: string = CONTRACTS_DIR): ProvenanceRecord {
  return parseProvenance(readFileSync(join(root, PROVENANCE_NAME), "utf8"));
}

/** كلُّ ملفٍّ منقولٍ، بأيِّ امتدادٍ وفي أيِّ عمقٍ، بمسارٍ نسبيٍّ مرتَّبٍ. */
export function listVendored(root: string, dir: string = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listVendored(root, full));
      continue;
    }
    const rel = relative(root, full);
    if (NOT_VENDORED.has(rel)) continue;
    out.push(rel);
  }
  return out;
}

export function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sha256OfBytes(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * تدقيقُ **التثبيتاتِ** وحدَها: كلُّ منقولٍ له تثبيتٌ واحدٌ، وكلُّ تثبيتٍ له ملفٌّ،
 * ولكلِّ منقولٍ بصمةٌ كذلكَ. دالّةٌ خالصةٌ تُرجِعُ الخروقَ ولا تطبعُ ولا تُخرِجُ
 * العمليّةَ، فتُقاسُ بخرقٍ مزروعٍ في مجلَّدٍ مؤقّتٍ.
 */
export function auditPins(root: string = CONTRACTS_DIR): readonly string[] {
  const breaches: string[] = [];
  const { fingerprints, pins, parseBreaches } = readProvenance(root);
  breaches.push(...parseBreaches);
  const vendored = listVendored(root);

  if (pins.size === 0) {
    breaches.push(
      `${join(root, PROVENANCE_NAME)}: لا سطرَ تثبيتٍ واحداً — سجلٌّ بلا تثبيتٍ لا يُقابَلُ آليّاً بمصدرِه`,
    );
  }

  for (const rel of vendored) {
    if (!pins.has(rel)) {
      breaches.push(
        `${rel}: ملفٌّ منقولٌ بلا سطرِ تثبيتٍ — لا يُعرَفُ من أيِّ مستودَعٍ ولا أيِّ التزامٍ ولا أيِّ مسارٍ نُقِلَ`,
      );
    }
    if (!fingerprints.has(rel)) {
      breaches.push(`${rel}: ملفٌّ منقولٌ بلا بصمةٍ — نقلٌ بلا إثباتٍ`);
    }
  }

  for (const [rel, pin] of pins) {
    if (!vendored.includes(rel)) {
      breaches.push(
        `${rel}: تثبيتٌ بلا ملفٍّ (${pin.repo}@${pin.commit.slice(0, 7)}) — إمّا حُذِفَ المنقولُ وإمّا أُخطئَ مسارُه`,
      );
    }
  }

  return breaches;
}
