/**
 * الغرض: حَكَمٌ نقيٌّ لنشراتِ ثغراتِ التبعيّاتِ — من مُخرَجِ `bun audit` إلى قائمةِ
 *   مخالفاتٍ، بسِجلِّ إقراراتٍ مغلقٍ لا بذاكرةِ مُراجِعٍ.
 * الحالة: منفَّذٌ فعليّاً — أُضيفَ في 2026-09-20 (الشقُّ المملوكُ للمستودَعِ من `SEC-15`).
 * ينتمي إلى: scripts/lib
 * الحاكم: ADR 0150 · `ح-7` (لكلِّ قاعدةٍ سالبةٌ مزروعةٌ)
 *
 * **لِمَ وحدةٌ نقيّةٌ منفصلةٌ عن الحاجزِ**: الحاجزُ يُشغِّلُ عمليّةً ويقرأُ شبكةً،
 * فلا يُبرهَنُ سقوطُه قاعدةً قاعدةً إلّا بحقائقَ مبذورةٍ. فههنا الحُكمُ وحدَه:
 * دوالُّ بلا قرصٍ ولا شبكةٍ ولا وقتٍ ضمنيٍّ — الوقتُ يُمرَّرُ.
 *
 * **وما لا يُدَّعى**: هذا يحكمُ على **نشراتٍ معروفةٍ منشورةٍ** في مُعجَمِ `npm`
 * لحظةَ القياسِ. لا يُدَّعى أنَّ صفرَ نشراتٍ يعني صفرَ ثغراتٍ، ولا أنَّ ما لا
 * يُغطّيهِ المُعجَمُ (صورُ `docker` · إجراءاتُ `GitHub`) مفحوصٌ ههنا.
 */

/** سُلَّمُ الشدّةِ من الأدنى إلى الأعلى — مغلقٌ، وما خرجَ عنهُ يُسقِطُ الحُكمَ. */
export const SEVERITY_LADDER = ["info", "low", "moderate", "high", "critical"] as const;

export type Severity = (typeof SEVERITY_LADDER)[number];

/**
 * حدُّ الإسقاطِ: نشرةٌ بشدّةٍ **عندَ هذا الحدِّ أو فوقَه** تُسقِطُ البناءَ إن لم
 * يكن لها إقرارٌ حيٌّ. و`moderate` اختيارٌ مقصودٌ: النشراتُ الثلاثُ التي كشفَها
 * القياسُ الأوّلُ على `hono` كلُّها `moderate`، وإحداها استنزافُ ذاكرةٍ في
 * `parseBody()` — أي في مسارِ كلِّ طلبٍ يدخلُ البوّابةَ. فحدٌّ عندَ `high` كانَ
 * سيُمرِّرُها صامتاً، والحدُّ الذي يُمرِّرُ ما كشفَهُ أوّلُ قياسٍ ليسَ حدّاً.
 */
export const FAILING_SEVERITY: Severity = "moderate";

/** أعلى حدٍّ مقبولٍ — يمنعُ تليينَ الحدِّ لاحقاً بتحريرِ الثابتِ. */
export const MAX_ALLOWED_THRESHOLD: Severity = "moderate";

/** أقلُّ طولٍ لسببِ الإقرارِ: «معروفٌ» و«لاحقاً» ليسا سبباً. */
export const MIN_ACK_REASON_LENGTH = 40;

/** مالكو الإقرارِ — قائمةٌ مغلقةٌ؛ إقرارٌ بلا مالكٍ لا يُرفَعُ أبداً. */
export const ACK_OWNERS = ["منفّذ المستودع", "مالك المشروع", "بنية تحتية (F9)"] as const;

export type AckOwner = (typeof ACK_OWNERS)[number];

/** نشرةٌ واحدةٌ كما تُقرأُ من مُخرَجِ `bun audit --json`. */
export interface Advisory {
  /** اسمُ الحزمةِ المُصابةِ كما يُخرِجُهُ المُعجَمُ. */
  readonly package: string;
  /** معرِّفُ النشرةِ — رقمٌ في مُعجَمِ `npm`. */
  readonly id: number;
  readonly title: string;
  readonly url: string;
  readonly severity: string;
  /** مدى النُسَخِ المُصابةِ كما وردَ نصّاً. */
  readonly vulnerableVersions: string;
}

/**
 * إقرارٌ بنشرةٍ بعينِها: **ليسَ كتماً** بل دَينٌ مكتوبٌ بمالكٍ وتاريخِ انتهاءٍ.
 * ومتى مضى التاريخُ سقطَ البناءُ — فالإقرارُ لا يُعمَّرُ بالإهمالِ.
 */
export interface Acknowledgement {
  readonly advisoryId: number;
  readonly package: string;
  /** **لِمَ لا تُرفَعُ النسخةُ الآنَ** — لا وصفُ النشرةِ. */
  readonly reason: string;
  readonly owner: AckOwner;
  /** تاريخُ انتهاءِ الإقرارِ `YYYY-MM-DD` — يُقارَنُ بوقتٍ مُمرَّرٍ لا بساعةِ النظامِ. */
  readonly expiresOn: string;
}

/**
 * سِجلُّ الإقراراتِ — **فارغٌ اليومَ عن قصدٍ**: النشراتُ الثلاثُ التي كشفَها
 * القياسُ الأوّلُ عُولِجَت بالرفعِ (`hono` ← `^4.13.5`) لا بالإقرارِ. والفارغُ
 * ههنا دعوى مقيسةٌ لا سهوٌ: قاعدةُ `ack.matches-advisory` تُسقِطُ أيَّ إقرارٍ لا
 * تُقابِلُه نشرةٌ قائمةٌ، فلا يبقى في السِجلِّ سطرٌ ميّتٌ.
 */
export const ACKNOWLEDGEMENTS: readonly Acknowledgement[] = [];

export const JUDGE_RULE_NAMES = [
  "audit.measured",
  "audit.severity-known",
  "audit.no-unacknowledged",
  "ack.reasoned",
  "ack.owned",
  "ack.not-expired",
  "ack.matches-advisory",
  "ack.unique",
  "threshold.sane",
] as const;

export type JudgeRuleName = (typeof JUDGE_RULE_NAMES)[number];

export interface AdvisoryViolation {
  readonly rule: JudgeRuleName;
  readonly detail: string;
}

export interface AuditFacts {
  /**
   * أنَّ الفحصَ **جرى فعلاً** وقُرِئَ مُخرَجُه. والعجزُ عن القياسِ عطبٌ لا أخضرُ:
   * `false` تُسقِطُ البناءَ ولو كانَت القائمةُ فارغةً.
   */
  readonly measured: boolean;
  readonly advisories: readonly Advisory[];
  /** سببُ تعذُّرِ القياسِ متى كانَ `measured` كاذباً. */
  readonly failure?: string | null;
}

export interface JudgeInputs {
  readonly facts: AuditFacts;
  readonly acknowledgements: readonly Acknowledgement[];
  readonly threshold: Severity;
  /** اللحظةُ التي يُقاسُ بها انتهاءُ الإقراراتِ — مُمرَّرةٌ لا مقروءةٌ. */
  readonly now: Date;
}

const severityRank = (severity: string): number => SEVERITY_LADDER.indexOf(severity as Severity);

/** أَتُسقِطُ هذهِ الشدّةُ البناءَ عندَ هذا الحدِّ؟ */
export const isFailingSeverity = (severity: string, threshold: Severity): boolean => {
  const rank = severityRank(severity);
  return rank >= 0 && rank >= severityRank(threshold);
};

const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * يقرأُ مُخرَجَ `bun audit --json`: كائنٌ مفاتيحُه أسماءُ الحزمِ وقيمُه مصفوفاتُ
 * نشراتٍ. ويُرمى عندَ ما لا يُقرأُ — ولا يُرَدُّ فارغاً، لأنَّ الفارغَ يُقرأُ
 * «لا ثغرةَ» وهوَ ههنا «لا أدري».
 */
export const parseAuditOutput = (raw: string): readonly Advisory[] => {
  const text = raw.trim();
  if (text.length === 0) {
    throw new Error("مُخرَجُ الفحصِ فارغٌ — ولا يُقرأُ الفارغُ «لا ثغرةَ».");
  }
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("مُخرَجُ الفحصِ ليسَ كائنَ حزمٍ.");
  }
  const advisories: Advisory[] = [];
  for (const [packageName, entries] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(entries)) {
      throw new Error(`قيمةُ «${packageName}» ليسَت مصفوفةَ نشراتٍ.`);
    }
    for (const entry of entries) {
      if (entry === null || typeof entry !== "object") {
        throw new Error(`نشرةٌ غيرُ مقروءةٍ في «${packageName}».`);
      }
      const record = entry as Record<string, unknown>;
      const id = record.id;
      const severity = record.severity;
      if (typeof id !== "number" || typeof severity !== "string") {
        throw new Error(`نشرةٌ بلا معرِّفٍ أو بلا شدّةٍ في «${packageName}».`);
      }
      advisories.push({
        package: packageName,
        id,
        title: typeof record.title === "string" ? record.title : "",
        url: typeof record.url === "string" ? record.url : "",
        severity,
        vulnerableVersions:
          typeof record.vulnerable_versions === "string" ? record.vulnerable_versions : "",
      });
    }
  }
  return advisories;
};

export const judgeAdvisories = (inputs: JudgeInputs): readonly AdvisoryViolation[] => {
  const violations: AdvisoryViolation[] = [];
  const { facts, acknowledgements, threshold, now } = inputs;

  if (severityRank(threshold) < 0) {
    violations.push({
      rule: "threshold.sane",
      detail: `حدُّ الإسقاطِ «${threshold}» ليسَ في سُلَّمِ الشدّةِ المغلقِ.`,
    });
  } else if (severityRank(threshold) > severityRank(MAX_ALLOWED_THRESHOLD)) {
    violations.push({
      rule: "threshold.sane",
      detail:
        `حدُّ الإسقاطِ «${threshold}» أعلى من المسموحِ «${MAX_ALLOWED_THRESHOLD}» — ` +
        "ورفعُ الحدِّ تليينٌ للبوّابةِ لا تهيئةٌ.",
    });
  }

  if (!facts.measured) {
    violations.push({
      rule: "audit.measured",
      detail: `لم يُقَس فحصُ النشراتِ: ${facts.failure ?? "بلا سببٍ مُعلَنٍ"}.`,
    });
  }

  for (const advisory of facts.advisories) {
    if (severityRank(advisory.severity) < 0) {
      violations.push({
        rule: "audit.severity-known",
        detail:
          `شدّةٌ مجهولةٌ «${advisory.severity}» في نشرةِ ${advisory.id} ` +
          `على «${advisory.package}» — والمجهولُ لا يُقاسُ دونَ الحدِّ.`,
      });
    }
  }

  const liveAcks = new Map<number, Acknowledgement>();
  const seen = new Set<number>();
  for (const ack of acknowledgements) {
    if (seen.has(ack.advisoryId)) {
      violations.push({
        rule: "ack.unique",
        detail: `إقرارٌ مكرَّرٌ للنشرةِ ${ack.advisoryId} — ومكرَّرانِ يتناقضانِ بلا حاكمٍ.`,
      });
      continue;
    }
    seen.add(ack.advisoryId);

    if (ack.reason.trim().length < MIN_ACK_REASON_LENGTH) {
      violations.push({
        rule: "ack.reasoned",
        detail:
          `سببُ إقرارِ النشرةِ ${ack.advisoryId} أقصرُ من ${MIN_ACK_REASON_LENGTH} حرفاً — ` +
          "وسببٌ لا يُقرأُ ليسَ سبباً.",
      });
    }

    if (!(ACK_OWNERS as readonly string[]).includes(ack.owner)) {
      violations.push({
        rule: "ack.owned",
        detail: `مالكُ إقرارِ النشرةِ ${ack.advisoryId} «${ack.owner}» ليسَ في القائمةِ المغلقةِ.`,
      });
    }

    if (!isIsoDate(ack.expiresOn)) {
      violations.push({
        rule: "ack.not-expired",
        detail: `تاريخُ انتهاءِ إقرارِ النشرةِ ${ack.advisoryId} ليسَ بصيغةِ YYYY-MM-DD.`,
      });
    } else if (new Date(`${ack.expiresOn}T23:59:59.999Z`).getTime() < now.getTime()) {
      violations.push({
        rule: "ack.not-expired",
        detail: `إقرارُ النشرةِ ${ack.advisoryId} انقضى في ${ack.expiresOn} — والمنقضي لا يشتري صمتاً.`,
      });
    } else {
      liveAcks.set(ack.advisoryId, ack);
    }

    const matching = facts.advisories.find(
      (advisory) => advisory.id === ack.advisoryId && advisory.package === ack.package,
    );
    if (facts.measured && matching === undefined) {
      violations.push({
        rule: "ack.matches-advisory",
        detail:
          `إقرارُ النشرةِ ${ack.advisoryId} على «${ack.package}» لا تُقابِلُه نشرةٌ قائمةٌ — ` +
          "والسطرُ الميّتُ يُقرأُ لاحقاً تغطيةً.",
      });
    }
  }

  for (const advisory of facts.advisories) {
    if (!isFailingSeverity(advisory.severity, threshold)) {
      continue;
    }
    if (liveAcks.has(advisory.id)) {
      continue;
    }
    violations.push({
      rule: "audit.no-unacknowledged",
      detail:
        `نشرةٌ بشدّةِ «${advisory.severity}» على «${advisory.package}» ` +
        `(${advisory.id} · ${advisory.url}) بلا إقرارٍ حيٍّ: ${advisory.title}`,
    });
  }

  return violations;
};

export const describeAdvisoryViolation = (violation: {
  readonly rule: string;
  readonly detail: string;
}): string => `  ✗ ${violation.rule}: ${violation.detail}`;

export const summarizeAdvisories = (facts: AuditFacts, threshold: Severity): string => {
  const failing = facts.advisories.filter((advisory) =>
    isFailingSeverity(advisory.severity, threshold),
  );
  const counts = new Map<string, number>();
  for (const advisory of facts.advisories) {
    counts.set(advisory.severity, (counts.get(advisory.severity) ?? 0) + 1);
  }
  const breakdown =
    counts.size === 0
      ? "لا نشرةَ"
      : [...counts.entries()].map(([severity, count]) => `${severity}: ${count}`).join(" · ");
  return (
    `${facts.advisories.length} نشرةً مقروءةً (${breakdown}) — ` +
    `${failing.length} عندَ الحدِّ «${threshold}» أو فوقَه`
  );
};
