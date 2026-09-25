/**
 * الغرض: حَكَمٌ خالصٌ واحدٌ لسلوكِ الرحلةِ حينَ يتوقَّفُ مزوّدُ الخرائطِ (`F11-06` —
 *   الشقُّ المملوكُ للمستودَعِ): **الرحلةُ لا تختفي، والمدّةُ تُخفى بصدقٍ، والقراءةُ
 *   لا تُعلَّقُ بتعليقِ المزوّدِ**.
 * الحالة: منفّذ فعلياً — يُستدعى من اختبارِ التكاملِ على السِلكِ.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: tests/integration/routing-provider-outage.test.ts (الحقائقُ المقيسةُ) ·
 *   tests/unit/routing-outage-judge.test.ts (السالباتُ المبذورةُ · `ح-7`)
 * الحاكم: docs/adr/0192-routing-outage-is-injected-on-the-wire.md
 *
 * ## لماذا حَكَمٌ خالصٌ لا توكيداتٌ مبثوثةٌ في الاختبارِ
 *
 * لأنَّ التوكيدَ الذي لا يُقاسُ بسالبةٍ مبذورةٍ قد يكونُ أخضرَ وهوَ معطوبٌ: اختبارُ
 * تكاملٍ يمرُّ لأنَّ المدّةَ غائبةٌ **لسببٍ آخرَ** (موقعٌ محجوبٌ · طورٌ مغلقٌ) يُقرأُ
 * «أُخفيَت بصدقٍ» وهوَ لم يسألِ المزوّدَ أصلاً. فالحَكَمُ يشترطُ **السببَ** بعينِه
 * (`PROVIDER_DOWN`) لا غيابَ الرقمِ وحدَه، ويُقاسُ بسالباتٍ تزرعُ كلَّ كذبةٍ ممكنةٍ.
 *
 * ## وما لا يحكمُ به عن قصدٍ
 *
 * ــ **لا يحكمُ على حِملٍ ولا على مزوّدٍ حقيقيٍّ**: البندُ في القسمِ الحادي عشرَ يُقصَدُ
 *    به بيئةٌ شبيهةٌ بالإنتاجِ (`F9-01`)؛ والمقيسُ ههنا رحلةٌ واحدةٌ تحتَ عطلٍ محقونٍ.
 * ــ **لا يُدينُ مدّةً مُخزَّنةً لمدخلاتٍ لم تتغيَّرْ**: جوابٌ صحيحٌ عن السؤالِ عينِه
 *    داخلَ مدّةِ الصلاحيّةِ (`CAP-012`) ليسَ كذباً؛ والعطلُ يُحقَنُ بموضعٍ جديدٍ.
 */

/** أطوارُ العطلِ المحقونةِ على السِلكِ — كلٌّ منها صنفُ فشلٍ مختلفٌ في المزوّدِ. */
export const OUTAGE_MODES = [
  "stopped",
  "hanging",
  "server_error",
  "malformed",
  "quota_exhausted",
] as const;

export type OutageMode = (typeof OUTAGE_MODES)[number];

/** الأطوارُ التي يبلغُ فيها الطلبُ معالِجَ الخادمِ — فصفرُ طلباتٍ فيها عطلٌ لم يُحقَنْ. */
const WIRE_REACHING_MODES: ReadonlySet<OutageMode> = new Set([
  "hanging",
  "server_error",
  "malformed",
]);

/**
 * هامشُ زمنِ القراءةِ فوقَ ميزانيّةِ المزوّدِ: قاعدةٌ حقيقيّةٌ ومُجدوِلٌ مشترَكٌ.
 * والميزانيّةُ نفسُها **مستوردةٌ** (`OSRM_TIMEOUT_MS`) لا مكتوبةٌ ههنا.
 */
export const OUTAGE_LATENCY_MARGIN_MS = 1_500;

/** الرحلةُ كما قُرِئَت — ما يجبُ ألّا يتغيَّرَ بعطلِ المزوّدِ. */
export interface RideSnapshot {
  readonly orderId: string;
  readonly status: string;
  readonly phase: string;
  readonly driverPresent: boolean;
  readonly positionShown: boolean;
}

export interface OutageReadFacts {
  readonly mode: OutageMode;
  readonly httpStatus: number;
  /** الرحلةُ قبلَ العطلِ (مقروءةٌ والمزوّدُ سليمٌ). */
  readonly before: RideSnapshot;
  /** الرحلةُ أثناءَ العطلِ — `null` إن لم تُوجَدْ في الردِّ. */
  readonly during: RideSnapshot | null;
  /** حالةُ صفِّ الطلبِ في القاعدةِ بعدَ القراءةِ. */
  readonly storedStatus: string;
  readonly etaKind: string | null;
  readonly etaReason: string | null;
  readonly elapsedMs: number;
  readonly providerBudgetMs: number;
  /** طلباتٌ وصلَت السِلكَ خلالَ القراءةِ — في طورِ الحصّةِ يجبُ أن تكونَ صفراً. */
  readonly wireCalls: number;
}

export interface OutageViolation {
  readonly rule: string;
  readonly mode: OutageMode | "recovery";
  readonly detail: string;
}

function sameRide(a: RideSnapshot, b: RideSnapshot): boolean {
  return (
    a.orderId === b.orderId &&
    a.status === b.status &&
    a.phase === b.phase &&
    a.driverPresent === b.driverPresent &&
    a.positionShown === b.positionShown
  );
}

/** يحكمُ على قراءةٍ واحدةٍ أثناءَ العطلِ. دالّةٌ خالصةٌ: حقائقُ تدخلُ وحكمٌ يخرجُ. */
export function judgeOutageRead(facts: OutageReadFacts): readonly OutageViolation[] {
  const found: OutageViolation[] = [];
  const { mode } = facts;
  if (facts.httpStatus !== 200) {
    found.push({
      rule: "outage.http-ok",
      mode,
      detail: `القراءةُ ردَّت ${String(facts.httpStatus)}: عطلُ حقلٍ تكميليٍّ أسقطَ الرحلةَ كلَّها.`,
    });
  }
  if (facts.during === null || !sameRide(facts.before, facts.during)) {
    found.push({
      rule: "outage.ride-intact",
      mode,
      detail:
        facts.during === null
          ? "الرحلةُ غائبةٌ عن الردِّ أثناءَ العطلِ — «الرحلةُ لا تختفي» مكسورٌ."
          : `الرحلةُ تغيَّرَت بعطلِ المزوّدِ: ${JSON.stringify(facts.before)} ⇒ ${JSON.stringify(facts.during)}.`,
    });
  }
  if (facts.storedStatus !== facts.before.status) {
    found.push({
      rule: "outage.ride-intact",
      mode,
      detail: `صفُّ الطلبِ في القاعدةِ صارَ «${facts.storedStatus}» بعدَ أن كانَ «${facts.before.status}»: قراءةٌ كتبَت.`,
    });
  }
  if (facts.etaKind !== "UNAVAILABLE") {
    found.push({
      rule: "outage.eta-hidden",
      mode,
      detail: `المدّةُ «${String(facts.etaKind)}» أثناءَ العطلِ: رقمٌ يُعرَضُ ولا مزوّدَ يُجيبُ — أو غيابٌ بلا حكمٍ.`,
    });
  } else if (facts.etaReason !== "PROVIDER_DOWN") {
    found.push({
      rule: "outage.eta-reason",
      mode,
      detail: `سببُ الإخفاءِ «${String(facts.etaReason)}» لا \`PROVIDER_DOWN\`: الراكبُ يُقالُ له سببٌ غيرُ الواقعِ.`,
    });
  }
  const ceiling = facts.providerBudgetMs + OUTAGE_LATENCY_MARGIN_MS;
  if (facts.elapsedMs > ceiling) {
    found.push({
      rule: "outage.bounded",
      mode,
      detail: `القراءةُ استغرقَت ${String(Math.round(facts.elapsedMs))}ms > ${String(ceiling)}ms: تعليقُ المزوّدِ علَّقَ الراكبَ.`,
    });
  }
  // العطلُ الذي لم يصلِ السِلكَ لم يُحقَنْ: قاطعٌ مفتوحٌ مسبقاً يُخفي المدّةَ بصدقٍ لكنَّه
  // يجعلُ الطورَ غيرَ مقيسٍ. و`stopped` مستثنىً: رفضُ الاتصالِ لا يبلغُ المعالِجَ أصلاً.
  if (WIRE_REACHING_MODES.has(mode) && facts.wireCalls < 1) {
    found.push({
      rule: "outage.injected",
      mode,
      detail: `صفرُ طلباتٍ وصلَت المزوّدَ في طورِ «${mode}»: العطلُ لم يُحقَنْ (قاطعٌ مفتوحٌ؟) فالطورُ غيرُ مقيسٍ.`,
    });
  }
  if (mode === "quota_exhausted" && facts.wireCalls !== 0) {
    found.push({
      rule: "outage.quota-no-wire",
      mode,
      detail: `${String(facts.wireCalls)} طلباً وصلَ المزوّدَ والحصّةُ مستنفَدةٌ: الحدُّ المُعلَنُ لا يمنعُ شيئاً (\`ADR 0190\`).`,
    });
  }
  return found;
}

export interface RecoveryFacts {
  readonly httpStatus: number;
  readonly etaKind: string | null;
  readonly wireCalls: number;
}

/** بعدَ عودةِ المزوّدِ: المدّةُ تعودُ من السِلكِ، لا فشلٌ مُخزَّنٌ يُعادُ. */
export function judgeRecovery(facts: RecoveryFacts): readonly OutageViolation[] {
  const found: OutageViolation[] = [];
  if (facts.httpStatus !== 200 || facts.etaKind !== "ROUTED") {
    found.push({
      rule: "recovery.eta-returns",
      mode: "recovery",
      detail: `بعدَ عودةِ المزوّدِ: ${String(facts.httpStatus)} · «${String(facts.etaKind)}» لا \`ROUTED\`.`,
    });
  }
  if (facts.wireCalls < 1) {
    found.push({
      rule: "recovery.from-wire",
      mode: "recovery",
      detail: "المدّةُ عادَت ولم يصلِ السِلكَ طلبٌ: ليسَت من المزوّدِ العائدِ.",
    });
  }
  return found;
}
