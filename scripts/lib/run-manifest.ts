/**
 * # سجلُّ بصمةِ التشغيل — `F9-05` · `OPS-007`
 *
 * **الغرض:** أن يُنتِجَ كلُّ تشغيلٍ في CI بصمةً قابلةً للقراءةِ آليّاً تُثبِتُ **أنَّ
 * ما جرى هو ما زُعِم**: الإصداراتُ والخدماتُ والحدودُ والحكمُ. والبصمةُ لا تُقرأُ
 * نجاحاً — تُقرأُ **دليلاً** يُفنَّدُ أو يُقبَل.
 *
 * **الحالة:** `F9-05` — مُنفَّذ · مُختبَر.
 *
 * **ينتمي إلى:** البند `F9-05` · القسم 9 · سلسلةُ `ci` في `package.json`.
 *
 * **ما لا يفعله هذا السجلُّ عن قصدٍ:**
 * - **لا يُشغِّل الاختبارات.** يقرأُ بصمةً كتبَها تشغيلٌ سبقَه.
 * - **لا يقرأُ قيمَ المتغيّراتِ.** بصمةُ المفتاحِ فقط — لا القيمة.
 * - **لا يحكمُ على صحّةِ السلوك.** يحكمُ على **وجودِ البصمةِ وكمالِ حقولِها**.
 */

/** حقولُ البصمةِ الواجبةُ — غيابُ أيٍّ منها يُسقِطُ الحاجزَ. */
export interface RunManifest {
  /** مُعرِّفُ الوظيفةِ في سيرِ العمل. */
  job: string;
  /** رابطُ الجولةِ في GitHub Actions. */
  runUrl: string;
  /** التزامُ SHA الذي جرى عليه التشغيل. */
  commitSha: string;
  /** الفرعُ أو المرجع. */
  ref: string;
  /** نوعُ الحدث: push · pull_request · workflow_dispatch. */
  event: string;
  /** حكمُ التشغيل: success · failure · cancelled. */
  verdict: "success" | "failure" | "cancelled";
  /** إصدارُ Bun. */
  bunVersion: string;
  /** إصدارُ Node. */
  nodeVersion: string;
  /** بصمةُ مفاتيحِ المتغيّراتِ البيئيّة (أسماءٌ مرتَّبةٌ لا قيم). */
  envKeyFingerprint: string;
  /** هل قاعدةُ البياناتِ حيّة؟ null إذا لم يُقَس. */
  dbProbe: "alive" | "dead" | null;
  /** هل Redis حيٌّ؟ null إذا لم يُقَس. */
  redisProbe: "alive" | "dead" | null;
  /** بصمةُ آخرِ هجرةٍ مطبَّقة (SHA-256 من اسمِ الملف). */
  migrationFingerprint: string;
  /** الحدودُ المعلَنةُ لهذا التشغيل. */
  knownLimits: string;
  /** الختمُ الزمنيُّ بتوقيت UTC ISO 8601. */
  timestamp: string;
}

/** الحقولُ الواجبةُ كلُّها — لا يُقبَلُ غيابُ واحدٍ منها. */
export const REQUIRED_FIELDS: readonly (keyof RunManifest)[] = [
  "job",
  "runUrl",
  "commitSha",
  "ref",
  "event",
  "verdict",
  "bunVersion",
  "nodeVersion",
  "envKeyFingerprint",
  "dbProbe",
  "redisProbe",
  "migrationFingerprint",
  "knownLimits",
  "timestamp",
] as const;

/** الوظائفُ التي يجبُ أن تُنتِجَ بصمةً. */
export const REQUIRED_JOBS = [
  "verify",
  "integration",
  "real-redis",
  "chaos-multi-instance",
] as const;

export type RequiredJob = (typeof REQUIRED_JOBS)[number];

/** قواعدُ الحاجزِ الساكنِ. */
export interface ManifestViolation {
  rule: string;
  detail: string;
}

/** يُدقِّقُ بصمةَ تشغيلٍ واحدة. */
export function auditRunManifest(
  raw: string,
  jobName: string,
): { manifest: RunManifest | null; violations: ManifestViolation[] } {
  const violations: ManifestViolation[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    violations.push({
      rule: "manifest.parseable",
      detail: `البصمةُ ليست JSON صالحاً — لا يُقرأُ النصُّ دليلاً.`,
    });
    return { manifest: null, violations };
  }

  const manifest = parsed as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (!(field in manifest) || manifest[field] === null || manifest[field] === undefined) {
      // dbProbe و redisProbe قد تكون null عن قصد
      if (field === "dbProbe" || field === "redisProbe") {
        if (!(field in manifest)) {
          violations.push({
            rule: "manifest.field-present",
            detail: `الحقلُ «${field}» غائبٌ — null مقبولٌ لكنَّ الغيابَ ليس غياباً.`,
          });
        }
      } else {
        violations.push({
          rule: "manifest.field-present",
          detail: `الحقلُ «${field}» غائبٌ أو فارغٌ — لا بصمةَ بلاه.`,
        });
      }
    }
  }

  // تحقُّقُ الحكم
  const verdict = manifest.verdict as string | undefined;
  if (verdict && !["success", "failure", "cancelled"].includes(verdict)) {
    violations.push({
      rule: "manifest.verdict-valid",
      detail: `الحكمُ «${verdict}» ليس success ولا failure ولا cancelled.`,
    });
  }

  // تحقُّقُ اسمِ الوظيفة
  const job = manifest.job as string | undefined;
  if (job && job !== jobName) {
    violations.push({
      rule: "manifest.job-matches",
      detail: `البصمةُ تقولُ إنَّ الوظيفةَ «${job}» لكنَّ المُدخَلَ «${jobName}».`,
    });
  }

  // تحقُّقُ البصمةِ لا تحوي قيماً
  const envFingerprint = manifest.envKeyFingerprint as string | undefined;
  if (envFingerprint && envFingerprint.length > 256) {
    violations.push({
      rule: "manifest.no-env-values",
      detail: `بصمةُ المفاتيحِ أطولُ من ٢٥٦ حرفاً — لا تُخزَنُ قيمٌ في البصمة.`,
    });
  }

  const result: RunManifest | null =
    violations.length === 0 ? (manifest as unknown as RunManifest) : null;

  return { manifest: result, violations };
}

/** يُدقِّقُ أنَّ كلَّ وظيفةٍ واجبةٍ أنتجت بصمةً. */
export function auditRequiredJobs(manifests: Record<string, string | null>): ManifestViolation[] {
  const violations: ManifestViolation[] = [];

  for (const job of REQUIRED_JOBS) {
    const raw = manifests[job];
    if (raw === null || raw === undefined) {
      violations.push({
        rule: "manifest.job-produced",
        detail: `الوظيفةُ «${job}» لم تُنتِجْ بصمةً — غيابُ البصمةِ ليس نجاحاً.`,
      });
    } else {
      const { violations: jobViolations } = auditRunManifest(raw, job);
      violations.push(...jobViolations);
    }
  }

  return violations;
}
