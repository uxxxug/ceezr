/**
 * # ميزانيّةُ بياناتِ جلسةِ الراكبِ — الصفُّ السابعُ من القسمِ 9.9 (`F1-09`)
 *
 * **الغرض:** أن يكونَ للحدِّ «استهلاكُ بياناتِ جلسةِ راكبٍ عشرَ دقائقَ ≤ 1.5 MB»
 * **حَكَمٌ** لا فقرةٌ في وثيقةٍ: دالّةٌ نقيّةٌ من **بايتاتٍ مقيسةٍ** إلى قائمةِ
 * مخالفاتٍ، ورقمٌ واحدٌ في المستودعِ كلِّه هوَ رقمُ العقدِ.
 *
 * **الحالة:** `F1-09` (الصفُّ السابعُ) — مُنفَّذ · مُختبَر · مبرهَنُ السقوطِ (`ح-7`).
 *   والصفوفُ الثلاثةُ الزمنيّةُ (`FCP` · `LCP` · زمنُ التفاعلِ) والصفُّ الثامنُ
 *   (إعادةُ رسمِ الخريطةِ) **ليست ههنا ولا يُدَّعى شيءٌ عنها** — تفصيلُها في
 *   `docs/evidence/architecture/F1-09-20260920.md`.
 *
 * **ينتمي إلى:** `scripts/lib` · البند `F1-09` · القسمُ 9.9 · القسمُ 9.10 · ADR 0042.
 *
 * **يُستخدَمُ من:** `tests/integration/rider-session-data-budget.test.ts` (القياسُ
 *   والتوكيدُ على قاعدةٍ حقيقيّةٍ) · `scripts/check-session-data-budget.ts`
 *   (الحاجزُ الساكنُ) · `tests/unit/session-data-budget.test.ts` (السالباتُ المبذورةُ).
 *
 * ## لماذا حكمٌ نقيٌّ منفصلٌ عن القياسِ
 *
 * القياسُ يحتاجُ قاعدةً حقيقيّةً وبوّابةً جاريةً وإطاراً مُشفَّراً؛ والحكمُ لا
 * يحتاجُ شيئاً. وفصلُهما هوَ ما يسمحُ ببرهانِ **سقوطِ** الحاجزِ بحقائقَ مصنوعةٍ
 * (`ح-7`)، وهوَ كذلكَ ما يمنعُ أن يصيرَ «الأخضرُ» أثرَ غيابِ قياسٍ: حقائقٌ بلا
 * إطارٍ أو بلا نداءٍ **تُسقِطُ الحكمَ** ولا تمرُّ (`session.frames-measured` ·
 * `session.calls-measured`). والأخضرُ الذي يعني «لم يُقَس شيءٌ» أسوأُ صنفٍ من
 * الأحمرِ.
 *
 * ## ما لا تفعلُه هذه الوحدةُ عن قصدٍ
 *
 * - **لا تقيسُ بايتاتِ سلكٍ.** المحسوبُ بايتاتُ **تطبيقٍ**: أجسادُ الردودِ
 *   وإطاراتُ `Socket.IO` المُشفَّرةُ نصّاً. ولا ضغطَ نقلٍ (`gzip`/`permessage-deflate`)
 *   ولا أقنعةَ `WebSocket` ولا ترويساتِ `HTTP`/`TCP`/`TLS` ولا إعادةَ اتّصالٍ.
 *   والضغطُ يخفضُ الرقمَ والترويساتُ ترفعُه، فالحسابُ ههنا **ليس أخفَّ من الحدِّ
 *   بالضرورةِ وليس أشدَّ** — وهذا يُصرَّحُ في الدليلِ ولا يُدَّعى غيرُه (`ح-5`).
 * - **لا تخترعُ عدَّ إطاراتٍ.** عددُ الإطاراتِ مشتقٌّ من مهلةِ المُرحِّلِ الدنيا
 *   **المستورَدةِ** (`DEFAULT_RELAY_MIN_INTERVAL_MS`) لا من رقمٍ يُكتَبُ ههنا.
 * - **لا تُخفِّفُ رقمَ العقدِ.** مَن أرادَ تخفيفَه فالطريقُ قرارٌ معماريٌّ مكتوبٌ
 *   لا تعديلُ ثابتٍ في ملفٍّ.
 */

/** كيلوبايتٌ ثنائيٌّ: 1 KB = 1024 بايت — كما في `scripts/lib/performance-budget.ts`. */
const KB = 1024;

/**
 * «استهلاكُ بياناتِ جلسةِ راكبٍ عشرَ دقائقَ ≤ 1.5 MB» — رقمُ القسمِ 9.9 بحرفِه.
 * **مصدرُ الحقيقةِ الوحيدُ** في المستودعِ، ويحرسُ وحدانيّتَه
 * `scripts/check-session-data-budget.ts`.
 */
export const SESSION_DATA_BUDGET_BYTES = 1.5 * 1024 * KB;

/** نافذةُ القياسِ التي ينصُّ عليها الصفُّ: عشرُ دقائقَ. */
export const SESSION_WINDOW_MS = 600_000;

/** ملفُّ القياسِ المحكومُ بهذهِ الميزانيّةِ — يقرؤه الحاجزُ الساكنُ. */
export const SESSION_DATA_TEST_FILE = "tests/integration/rider-session-data-budget.test.ts";

/** نصُّ صفِّ العقدِ في `docs/ROADMAP-MASTER.md` §9.9 — يُطابِقُه الحاجزُ حرفاً. */
export const CONTRACT_ROW_MARKER = "استهلاك بيانات جلسة راكب 10 دقائق";

/**
 * شكلُ جلسةِ الراكبِ في النافذةِ: **كم مرّةً يُنادى كلُّ مسارٍ ولماذا**.
 *
 * والأعدادُ ههنا **مُعلَنةٌ لا مقيسةٌ**، وهذا حدٌّ مكتوبٌ لا مطويٌّ: لا توزيعَ
 * سلوكٍ حقيقيٍّ في المستودعِ (لا نشرَ حيَّ · `ADR 0099`)، فلا يُدَّعى أنَّ راكباً
 * فعلَ هذا. والذي يجعلُ الإعلانَ مقبولاً أمرانِ: (١) **البايتاتُ مقيسةٌ** من ردٍّ
 * حقيقيٍّ لكلِّ مسارٍ، فالمتغيِّرُ الذي ينمو بلا رقيبٍ — حجمُ الحمولةِ —
 * مَحروسٌ؛ و(٢) **لا استقصاءَ دوريّاً في التطبيقِ المصغَّرِ** (`ADR 0035` §٤ ·
 * القسمُ 9.7 · يفرضُه `scripts/check-system-screens-policy.ts`)، فعددُ نداءاتِ
 * القراءةِ يحدُّه فعلُ المستخدمِ لا مؤقّتٌ — والعددُ الوحيدُ الذي **تفرضُه
 * الشيفرةُ** في النافذةِ هوَ عددُ إطاراتِ القناةِ، وهوَ مشتقٌّ من مهلةِ
 * المُرحِّلِ لا مكتوبٌ ههنا.
 *
 * ولو صارَ يوماً استقصاءٌ دوريٌّ في شاشةٍ، فهذا الجدولُ يصيرُ كذباً — ولذلكَ
 * يحرسُ الحاجزُ أن يبقى `check-system-screens-policy` في سلسلةِ `ci`.
 */
export const RIDER_SESSION_PROFILE: readonly {
  readonly label: string;
  readonly callsInWindow: number;
  readonly reason: string;
}[] = [
  {
    label: "POST /v1/session/telegram",
    callsInWindow: 1,
    reason: "فتحُ التطبيقِ مرّةً: الجلسةُ تُصدَرُ عندَ الإقلاعِ وتُجدَّدُ بمسارِ التجديدِ لا بإعادةِ الإصدارِ",
  },
  {
    label: "GET /v1/me",
    callsInWindow: 1,
    reason: "الدورُ يُقرأُ مرّةً عندَ الإقلاعِ — لا مؤقّتَ ولا استقصاءَ (`ADR 0035` §٤)",
  },
  {
    label: "GET /v1/me/places",
    callsInWindow: 1,
    reason: "سطحُ الراكبِ يقرأُ أماكنَه المحفوظةَ عندَ الفتحِ",
  },
  {
    label: "GET /v1/destinations/search",
    callsInWindow: 3,
    reason:
      "ثلاثُ استفساراتٍ مكتوبةٍ خلفَ ارتدادٍ 300 ms — شكلٌ مُعلَنٌ لتقصٍّ متوسِّطٍ، لا سقفٌ على كتابةِ مستخدمٍ",
  },
  {
    label: "POST /v1/rides",
    callsInWindow: 1,
    reason:
      "إنشاءٌ واحدٌ بمفتاحِ تكرارٍ — والضغطةُ الثانيةُ تُعيدُ الرحلةَ عينَها لا تُنشئُ ثانيةً (`ARCH-006`)",
  },
  {
    label: "GET /v1/rides/:id/search",
    callsInWindow: 4,
    reason: "أربعُ ضغطاتِ «تحديثٍ» يدويّةٍ في شاشةِ البحثِ — الزرُّ فعلُ مستخدمٍ ولا مؤقّتَ يقرأُ عنه",
  },
  {
    label: "GET /v1/rides/:id",
    callsInWindow: 2,
    reason: "فتحُ سطحِ الرحلةِ النشطةِ ثمَّ عودةٌ إليهِ بعدَ خروجٍ — القراءةُ لقطةٌ بطلبٍ (`ADR 0035` §٤)",
  },
  {
    label: "GET /v1/rides/:id/summary",
    callsInWindow: 1,
    reason: "ملخَّصُ الرحلةِ يُقرأُ مرّةً عندَ انتهائِها",
  },
];

/** أسماءُ قواعدِ الحكمِ — مُصدَّرةٌ كي تُبذَرَ سالبةٌ لكلِّ واحدةٍ (`ح-7`). */
export const SESSION_RULE_NAMES = [
  "session.interval-positive",
  "session.interval-within-window",
  "session.frames-measured",
  "session.calls-measured",
  "session.first-load-measured",
  "session.no-negative",
  "session.within-budget",
] as const;

export type SessionRuleName = (typeof SESSION_RULE_NAMES)[number];

/** نداءُ شبكةٍ واحدٌ في نافذةِ العشرِ دقائقِ، ببايتاتِه المقيسةِ وعددِ تكرارِه. */
export interface MeasuredHttpCall {
  /** وسمٌ يُقرأُ في المخرَجِ: المسارُ كما نُودِيَ. */
  readonly label: string;
  /** طولُ جسدِ الردِّ بالبايتِ — مقيسٌ لا مُقدَّرٌ. */
  readonly bytes: number;
  /** كم مرّةً يُنادى في نافذةِ العشرِ دقائقِ لجلسةِ راكبٍ واحدةٍ. */
  readonly callsInWindow: number;
}

/** حقائقُ الجلسةِ المقيسةُ — لا شيءَ ههنا مُقدَّرٌ ولا مأخوذٌ من وثيقةٍ. */
export interface SessionDataFacts {
  /**
   * بايتاتُ الحملِ الأوّلِ: تُحسَبُ **بسقفِها المفروضِ** (`BUDGET.eagerGzipBytes`
   * = 180 KB) لا ببناءٍ مقيسٍ. وهذا **أشدُّ من القياسِ لا أخفُّ**: بناءُ
   * 2026-08-29 قِيسَ ≈ 70.8 KB، والسقفُ يُسقِطُ البناءَ إن تُجوِّزَ
   * (`scripts/check-performance-budget.ts`). فالرقمُ حدٌّ عُلويٌّ مُنفَذٌ آلياً،
   * ومصدرُه واحدٌ لا يُكرَّرُ ههنا.
   */
  readonly firstLoadBytes: number;
  /** نداءاتُ البوّابةِ في النافذةِ. */
  readonly httpCalls: readonly MeasuredHttpCall[];
  /** طولُ إطارِ `ride:event` المُشفَّرِ بالبايتِ. */
  readonly liveFrameBytes: number;
  /** مهلةُ المُرحِّلِ الدنيا — تُستورَدُ من `customer-live-relay.ts` ولا تُكتَبُ. */
  readonly liveFrameIntervalMs: number;
  /** بايتاتُ فتحِ القناةِ مرّةً واحدةً (المُصافحةُ + `ride:joined`). */
  readonly channelOpenBytes: number;
}

export interface SessionDataViolation {
  readonly rule: SessionRuleName;
  readonly detail: string;
}

export interface SessionDataVerdict {
  readonly frameCount: number;
  readonly liveBytes: number;
  readonly httpBytes: number;
  readonly totalBytes: number;
  readonly violations: readonly SessionDataViolation[];
}

/**
 * عددُ إطاراتِ الموقعِ في النافذةِ عندَ أسوأِ حالٍ مسموحٍ بها: أوّلُ إطارٍ عندَ
 * الاشتراكِ (`+1`)، ثمَّ إطارٌ كلَّ مهلةٍ دنيا. والمُرحِّلُ **لا يبثُّ أسرعَ** من
 * هذهِ المهلةِ (`customer-live-relay.ts`)، فهذا سقفٌ لا متوسِّطٌ.
 */
export function liveFrameCount(windowMs: number, intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 0;
  return Math.floor(windowMs / intervalMs) + 1;
}

function fmt(bytes: number): string {
  return `${bytes} بايتاً (${(bytes / (1024 * KB)).toFixed(3)} MB)`;
}

/**
 * الحكمُ: من حقائقَ مقيسةٍ إلى مخالفاتٍ. لا قرصَ ولا شبكةَ ولا بيئةَ ههنا.
 */
export function judgeSessionData(facts: SessionDataFacts): SessionDataVerdict {
  const violations: SessionDataViolation[] = [];
  const push = (rule: SessionRuleName, detail: string): void => {
    violations.push({ rule, detail });
  };

  const interval = facts.liveFrameIntervalMs;
  if (!Number.isFinite(interval) || interval <= 0) {
    push(
      "session.interval-positive",
      `مهلةُ المُرحِّلِ الدنيا غيرُ صالحةٍ: ${String(interval)} — فلا عددَ إطاراتٍ يُشتَقُّ منها`,
    );
  } else if (interval > SESSION_WINDOW_MS) {
    push(
      "session.interval-within-window",
      `مهلةُ المُرحِّلِ (${interval} ms) أطولُ من نافذةِ القياسِ (${SESSION_WINDOW_MS} ms) — النافذةُ لا تحملُ إطاراً دوريّاً واحداً`,
    );
  }

  if (!Number.isFinite(facts.liveFrameBytes) || facts.liveFrameBytes <= 0) {
    push(
      "session.frames-measured",
      "إطارُ `ride:event` بصفرِ بايتٍ — حقائقٌ بلا إطارٍ مقيسٍ تعني أنَّ القناةَ لم تُقَس، فالأخضرُ ههنا غيابُ قياسٍ لا التزامٌ بحدٍّ",
    );
  }

  if (facts.httpCalls.length === 0) {
    push(
      "session.calls-measured",
      "لا نداءَ واحدٌ مقيسٌ في النافذةِ — جلسةُ راكبٍ بلا نداءِ بوّابةٍ ليست جلسةً",
    );
  }
  for (const call of facts.httpCalls) {
    if (!Number.isFinite(call.bytes) || call.bytes <= 0) {
      push("session.calls-measured", `النداءُ «${call.label}» بجسدٍ صفرِ البايتِ — غيرُ مقيسٍ`);
    }
    if (!Number.isInteger(call.callsInWindow) || call.callsInWindow <= 0) {
      push(
        "session.calls-measured",
        `النداءُ «${call.label}» بعددِ تكرارٍ غيرِ صالحٍ: ${String(call.callsInWindow)}`,
      );
    }
    if (call.bytes < 0 || call.callsInWindow < 0) {
      push("session.no-negative", `النداءُ «${call.label}» بقيمةٍ سالبةٍ`);
    }
  }

  if (!Number.isFinite(facts.firstLoadBytes) || facts.firstLoadBytes <= 0) {
    push(
      "session.first-load-measured",
      "بايتاتُ الحملِ الأوّلِ صفرٌ — والجلسةُ تبدأُ بفتحِ التطبيقِ، فإغفالُها تخفيفٌ للحدِّ بالحذفِ",
    );
  }

  for (const [name, value] of [
    ["firstLoadBytes", facts.firstLoadBytes],
    ["liveFrameBytes", facts.liveFrameBytes],
    ["channelOpenBytes", facts.channelOpenBytes],
  ] as const) {
    if (Number.isFinite(value) && value < 0) {
      push("session.no-negative", `${name} سالبٌ: ${String(value)}`);
    }
  }

  const frameCount = liveFrameCount(SESSION_WINDOW_MS, interval);
  const liveBytes =
    frameCount * Math.max(0, facts.liveFrameBytes) + Math.max(0, facts.channelOpenBytes);
  const httpBytes = facts.httpCalls.reduce(
    (sum, call) => sum + Math.max(0, call.bytes) * Math.max(0, call.callsInWindow),
    0,
  );
  const totalBytes = Math.max(0, facts.firstLoadBytes) + httpBytes + liveBytes;

  // الحدُّ «≤» لا «<» — بنصِّ الصفِّ.
  if (totalBytes > SESSION_DATA_BUDGET_BYTES) {
    push(
      "session.within-budget",
      `جلسةُ عشرِ دقائقَ تنقلُ ${fmt(totalBytes)} والحدُّ ${fmt(SESSION_DATA_BUDGET_BYTES)} — الحملُ الأوّلُ ${fmt(facts.firstLoadBytes)} · النداءاتُ ${fmt(httpBytes)} · القناةُ ${fmt(liveBytes)} في ${frameCount} إطاراً`,
    );
  }

  return { frameCount, liveBytes, httpBytes, totalBytes, violations };
}

/**
 * تركيبُ نداءاتِ النافذةِ: أعدادُها وأسبابُها من `RIDER_SESSION_PROFILE`،
 * وبايتاتُها من **قياسٍ** يُمرَّرُ بالوسمِ. ووسمٌ في الشكلِ بلا قياسٍ يصيرُ
 * صفراً — فيُسقِطُه الحكمُ بقاعدةِ `session.calls-measured` ولا يمرُّ صامتاً.
 */
export function composeHttpCalls(
  measuredBytesByLabel: Readonly<Record<string, number>>,
): readonly MeasuredHttpCall[] {
  return RIDER_SESSION_PROFILE.map((entry) => ({
    label: entry.label,
    bytes: measuredBytesByLabel[entry.label] ?? 0,
    callsInWindow: entry.callsInWindow,
  }));
}

/** تقريرٌ يُطبَعُ كما هوَ في المخرَجِ — الأرقامُ كلُّها لا المخالفاتُ وحدَها. */
export function describeSessionData(facts: SessionDataFacts, verdict: SessionDataVerdict): string {
  const lines = [
    `الحملُ الأوّلُ: ${fmt(facts.firstLoadBytes)}`,
    `النداءاتُ (${facts.httpCalls.length}): ${fmt(verdict.httpBytes)}`,
    ...facts.httpCalls.map(
      (call) =>
        `  · ${call.label} × ${call.callsInWindow} = ${call.bytes * call.callsInWindow} بايتاً`,
    ),
    `القناةُ: ${verdict.frameCount} إطاراً × ${facts.liveFrameBytes} بايتاً + فتحٌ ${facts.channelOpenBytes} = ${fmt(verdict.liveBytes)}`,
    `المجموعُ: ${fmt(verdict.totalBytes)} من حدٍّ ${fmt(SESSION_DATA_BUDGET_BYTES)}`,
  ];
  return lines.join("\n");
}
