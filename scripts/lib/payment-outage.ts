/**
 * الغرض: حَكَمٌ خالصٌ واحدٌ لسلوكِ معاملةِ الدفعِ حينَ يتوقّفُ مزوّدُ الدفعِ (`F11-07` —
 *   الشقُّ المملوكُ للمستودَعِ): **المعاملةُ تبقى `pending/recoverable` بلا خسارةٍ**.
 * الحالة: منفّذ فعلياً — يُستدعى من اختبارِ التكاملِ على السِلكِ.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: tests/integration/payment-provider-outage.test.ts (الحقائقُ المقيسةُ) ·
 *   tests/unit/payment-outage-judge.test.ts (السالباتُ المبذورةُ · `ح-7`)
 * الحاكم: docs/adr/0200-payment-provider-outage-is-pending-recoverable.md
 *
 * ## لماذا حَكَمٌ خالصٌ لا توكيداتٌ مبثوثةٌ في الاختبارِ
 *
 * لأنَّ التوكيدَ الذي لا يُقاسُ بسالبةٍ مبذورةٍ قد يكونُ أخضرَ وهوَ معطوبٌ: «فشلُ
 * الشحنةِ» قد يمرَّ لأنَّ الاختبارَ لم يُنشئِ الصفَّ أصلًا، و«الاستعادةُ بعدَ التعافي»
 * قد تمرَّ والرابطُ `null` — نجاحٌ كاذبٌ لا دفعَ فيهِ (`D-38`). فالحَكَمُ يشترطُ
 * السببَ بعينِهِ لا غيابَ العطبِ وحدَه، ويُقاسُ بسالباتٍ تزرعُ كلَّ كذبةٍ ممكنةٍ.
 *
 * ## وما لا يحكمُ به عن قصدٍ
 *
 * ــ **لا يحكمُ على مزوّدٍ حقيقيٍّ ولا على أموالٍ**: البندُ في القسمِ الحادي عشرَ
 *    يُقصَدُ به بيئةٌ شبيهةٌ بالإنتاجِ؛ والمقيسُ ههنا خادمٌ محليٌّ يحاكي عقدَ Tap.
 * ــ **لا يحكمُ على تغطيةِ المراجعةِ للصفوفِ بلا مرجعِ مزوّدٍ**: ذاك إفصاحٌ
 *    مُعلَنٌ في `reconcile-pending-payments.ts` لا عطبٌ يُكتشَفُ ههنا.
 */

/** أطوارُ العطلِ المحقونةِ على السِلكِ — كلٌّ منها صنفُ فشلٍ مختلفٌ في المزوّدِ. */
export const OUTAGE_MODES = ["stopped", "hanging", "server_error", "malformed"] as const;

export type PaymentOutageMode = (typeof OUTAGE_MODES)[number];

/** الأطوارُ التي يبلغُ فيها الطلبُ معالِجَ الخادمِ — فصفرُ طلباتٍ فيها عطلٌ لم يُحقَنْ. */
const WIRE_REACHING_MODES: ReadonlySet<PaymentOutageMode> = new Set([
  "hanging",
  "server_error",
  "malformed",
]);

export interface PaymentOutageViolation {
  readonly rule: string;
  readonly mode: PaymentOutageMode | "recovery" | "settlement";
  readonly detail: string;
}

/** حقائقُ محاولةِ بدءِ شحنةٍ أثناءَ العطلِ. */
export interface ChargeOutageFacts {
  readonly mode: PaymentOutageMode;
  /** هل ردَّت حالةُ الاستخدامِ بخطأٍ صادقٍ (لا نجاحَ بلا رابطٍ)؟ */
  readonly rejected: boolean;
  /** حالةُ صفِّ المعاملةِ في القاعدةِ بعدَ المحاولةِ. */
  readonly rowStatus: string;
  readonly providerReference: string | null;
  /** قيودُ دفترِ الأستاذِ للمعاملةِ بعدَ المحاولةِ. */
  readonly ledgerEntries: number;
  /** هل يوجدُ اشتراكٌ فعّالٌ للسائقِ بعدَ المحاولةِ؟ */
  readonly subscriptionActive: boolean;
  /** طلباتُ الشحنةِ التي وصلَت السِلكَ خلالَ المحاولةِ. */
  readonly wireCalls: number;
}

/** يحكمُ على بدءِ شحنةٍ واحدةٍ أثناءَ العطلِ. دالّةٌ خالصةٌ. */
export function judgeChargeOutage(facts: ChargeOutageFacts): readonly PaymentOutageViolation[] {
  const found: PaymentOutageViolation[] = [];
  const { mode } = facts;
  if (!facts.rejected) {
    found.push({
      rule: "charge.outage-honest",
      mode,
      detail:
        "بدءُ الشحنةِ أثناءَ عطلِ المزوّدِ عادَ بنجاحٍ: عطلٌ يُنجَحُ صامتاً يُوهِمُ السائقَ أنَّ دفعَهُ بدأَ وهوَ لم يبدأْ.",
    });
  }
  if (facts.rowStatus !== "pending") {
    found.push({
      rule: "charge.row-pending",
      mode,
      detail: `صفُّ المعاملةِ صارَ «${facts.rowStatus}» بعطلِ المزوّدِ: المعاملةُ يجبُ أن تبقى معلَّقةً لا أن تُغلَقَ أو تُفعَّلَ بعطبٍ.`,
    });
  }
  if (facts.providerReference !== null) {
    found.push({
      rule: "charge.no-provider-reference",
      mode,
      detail:
        "مرجعُ مزوّدٍ محفوظٌ لمعاملةٍ لم يبدأها المزوّدُ: مرجعٌ مُختلَقٌ يُسألُ به المزوّدُ لاحقاً عن دفعةٍ لا وجودَ لها.",
    });
  }
  if (facts.ledgerEntries !== 0) {
    found.push({
      rule: "charge.no-ledger",
      mode,
      detail: `${String(facts.ledgerEntries)} قيداً في دفترِ الأستاذِ بعطلِ المزوّدِ: لا حركةَ ماليّةَ بلا دفعٍ حقيقيٍّ.`,
    });
  }
  if (facts.subscriptionActive) {
    found.push({
      rule: "charge.no-activation",
      mode,
      detail: "اشتراكٌ فعّالٌ بعدَ محاولةِ شحنةٍ فاشلةٍ: تفعيلٌ بلا دفعٍ (`F11-07` مكسورٌ في أخطرِ وجهِهِ).",
    });
  }
  // العطلُ الذي لم يصلِ السِلكَ لم يُحقَنْ. و`stopped` مستثنىً: رفضُ الاتصالِ لا يبلغُ المعالِجَ أصلاً.
  if (WIRE_REACHING_MODES.has(mode) && facts.wireCalls < 1) {
    found.push({
      rule: "charge.outage-injected",
      mode,
      detail: `صفرُ طلباتِ شحنةٍ وصلَت المزوّدَ في طورِ «${mode}»: العطلُ لم يُحقَنْ فالطورُ غيرُ مقيسٍ.`,
    });
  }
  return found;
}

/** حقائقُ إعادةِ المحاولةِ (نفسُ مفتاحِ التفرّدِ) بعدَ تعافي المزوّدِ. */
export interface ChargeRecoveryFacts {
  /** رابطُ الدفعِ الذي عادَ للسائقِ في المحاولةِ الثانيةِ — `null` يعني سجنَهُ. */
  readonly checkoutUrl: string | null;
  /** هل بدأَ المزوّدُ شحنةً جديدةً للمحاولةِ الثانيةِ (على الصفِّ نفسِهِ)؟ */
  readonly secondChargeStarted: boolean;
  /** عددُ صفوفِ المعاملاتِ التي يحملُها مفتاحُ التفرّدِ — الواحدُ هوَ الصوابُ. */
  readonly rowsForKey: number;
  readonly rowStatus: string;
  readonly providerReference: string | null;
  readonly ledgerEntries: number;
  readonly subscriptionActive: boolean;
}

/** يحكمُ على استعادةِ السائقِ رابطَ دفعِهِ بعدَ التعافي — جوهرُ `D-38`. */
export function judgeChargeRecovery(facts: ChargeRecoveryFacts): readonly PaymentOutageViolation[] {
  const found: PaymentOutageViolation[] = [];
  if (facts.checkoutUrl === null || facts.checkoutUrl.length === 0) {
    found.push({
      rule: "recovery.checkout-url",
      mode: "recovery",
      detail:
        "المحاولةُ الثانيةُ بعدَ التعافي عادَت برابطِ دفعٍ `null`: السائقُ مسجونٌ بمعاملةٍ لا يستطيعُ دفعَها ومفتاحٍ يمنعُ غيرَها (`D-38`).",
    });
  }
  if (!facts.secondChargeStarted) {
    found.push({
      rule: "recovery.charge-restarted",
      mode: "recovery",
      detail:
        "المزوّدُ لم يبدأْ شحنةً في المحاولةِ الثانيةِ: «الاستعادةُ» أعادَت الصفَّ القديمَ بلا شحنةٍ — نجاحٌ كاذبٌ لا سبيلَ فيهِ للدفعِ.",
    });
  }
  if (facts.rowsForKey !== 1) {
    found.push({
      rule: "recovery.single-row",
      mode: "recovery",
      detail: `${String(facts.rowsForKey)} صفوفٍ لمفتاحِ تفرّدٍ واحدٍ: إعادةُ المحاولةِ أنشأَت معاملةً ثانيةً لا صفحنتِها، فحمايةُ التكرارِ مكسورةٌ.`,
    });
  }
  if (facts.rowStatus !== "pending") {
    found.push({
      rule: "recovery.row-pending",
      mode: "recovery",
      detail: `صفُّ المعاملةِ «${facts.rowStatus}» بعدَ استئنافِ الشحنةِ: يجبُ أن يبقى معلَّقاً حتى حسمِ الويبهوكِ أو المراجعةِ.`,
    });
  }
  if (facts.providerReference === null) {
    found.push({
      rule: "recovery.reference-recorded",
      mode: "recovery",
      detail:
        "الشحنةُ بدأَت بلا مرجعِ مزوّدٍ محفوظٍ: الدفعةُ غيرُ قابلةٍ للمراجعةِ لو ضاعَ الويبهوكُ (`reconcile` لن يجدَ ما يسألُ عنهُ).",
    });
  }
  if (facts.ledgerEntries !== 0) {
    found.push({
      rule: "recovery.no-ledger",
      mode: "recovery",
      detail: `${String(facts.ledgerEntries)} قيداً بعدَ استئنافِ الشحنةِ: لا حركةً ماليّةً قبلَ الدفعِ الفعليِّ.`,
    });
  }
  if (facts.subscriptionActive) {
    found.push({
      rule: "recovery.no-activation",
      mode: "recovery",
      detail: "اشتراكٌ فعّالٌ بمجرّدِ استئنافِ الشحنةِ: التفعيلُ حقُّ الويبهوكِ أو المراجعةِ لا بدءِ الشحنةِ.",
    });
  }
  return found;
}

/** حقائقُ مراجعةِ الدفعاتِ المعلّقةِ أثناءَ العطلِ. */
export interface ReconcileOutageFacts {
  readonly mode: PaymentOutageMode;
  readonly examined: number;
  /** فشلَ سؤالُ المزوّدِ أو المطابقةُ — مرصودٌ لا مكتومٌ. */
  readonly failed: number;
  readonly settled: number;
  /** حالةُ الصفِّ المعلَّقِ (بمرجعِ مزوّدٍ) بعدَ المراجعةِ. */
  readonly rowStatus: string;
  readonly ledgerEntries: number;
  readonly subscriptionActive: boolean;
  readonly wireCalls: number;
}

/** يحكمُ على دورةِ مراجعةٍ واحدةٍ أثناءَ العطلِ. */
export function judgeReconcileOutage(
  facts: ReconcileOutageFacts,
): readonly PaymentOutageViolation[] {
  const found: PaymentOutageViolation[] = [];
  const { mode } = facts;
  if (facts.examined < 1) {
    found.push({
      rule: "reconcile.examined",
      mode,
      detail: "المراجعةُ لم تُرشِّحْ صفًّا معلَّقاً بمرجعِ مزوّدٍ: القياسُ أعمى قبلَ أن يبدأَ.",
    });
  } else {
    if (facts.settled !== 0) {
      found.push({
        rule: "reconcile.no-settlement",
        mode,
        detail: `${String(facts.settled)} دفعةً حُسمَت أثناءَ عطلِ المزوّدِ: حسمٌ بلا قراءةٍ من خادمِهِ مالٌ يُنشَأُ من عدمٍ.`,
      });
    }
    if (facts.failed !== facts.examined) {
      found.push({
        rule: "reconcile.failure-honest",
        mode,
        detail: `فشلَت ${String(facts.failed)} من ${String(facts.examined)}: العطلُ يُكتَمُ في عدّادٍ لا يُطابِقُ ما رشّحَتْهُ القاعدةُ.`,
      });
    }
  }
  if (facts.rowStatus !== "pending") {
    found.push({
      rule: "reconcile.row-stays-pending",
      mode,
      detail: `الصفُّ المعلَّقُ صارَ «${facts.rowStatus}» بمراجعةٍ فاشلةٍ: الفشلُ المعزولُ لا يُغلقُ معاملةً ولا يُفسِدُها.`,
    });
  }
  if (facts.ledgerEntries !== 0) {
    found.push({
      rule: "reconcile.no-ledger",
      mode,
      detail: `${String(facts.ledgerEntries)} قيداً في دفترِ الأستاذِ أثناءَ عطلِ المزوّدِ: لا حركةً ماليّةً من مراجعةٍ لا تصلُ للمزوّدِ.`,
    });
  }
  if (facts.subscriptionActive) {
    found.push({
      rule: "reconcile.no-activation",
      mode,
      detail: "اشتراكٌ فعّالٌ بعدَ مراجعةٍ فاشلةٍ: تفعيلٌ بلا قراءةٍ من المزوّدِ.",
    });
  }
  if (WIRE_REACHING_MODES.has(mode) && facts.wireCalls < 1) {
    found.push({
      rule: "reconcile.outage-injected",
      mode,
      detail: `صفرُ طلباتِ قراءةٍ وصلَت المزوّدَ في طورِ «${mode}»: العطلُ لم يُحقَنْ فالطورُ غيرُ مقيسٍ.`,
    });
  }
  return found;
}

/** حقائقُ التسويةِ بعدَ التعافي — كلُّها عن معاملةِ الاختبارِ ذاتِها. */
export interface SettlementFacts {
  /** هل حُسِمَت معاملةُ الاختبارِ في الجولةِ الأولىِ (قلبُ الحالةِ إلى `active`)؟ */
  readonly rowSettledFirstRound: 0 | 1;
  /** مجموعُ ما حسمَتْهُ الجولةُ الثانيةُ — لا شيءَ أصلًا ولا أثرٌ مكرَّرٌ. */
  readonly secondRoundSettled: number;
  /** هل ما زالت معاملةُ الاختبارِ تُرشَّحُ للمراجعةِ بعدَ حسمِها؟ */
  readonly rowStillStaleAfterSettlement: boolean;
  readonly rowStatus: string;
  readonly ledgerEntries: number;
  readonly subscriptionActiveCount: number;
}

/** يحكمُ على التسويةِ بعدَ التعافي: مرّةً واحدةً لا أكثر. */
export function judgeSettlement(facts: SettlementFacts): readonly PaymentOutageViolation[] {
  const found: PaymentOutageViolation[] = [];
  if (facts.rowSettledFirstRound !== 1) {
    found.push({
      rule: "settlement.settled-once",
      mode: "settlement",
      detail:
        "الجولةُ الأولىُ لم تحسِمْ معاملةَ الاختبارِ: تعافي المزوّدِ يجبُ أن يُسوّيَ الدفعةَ المعلَّقةَ ذاتَها.",
    });
  }
  if (facts.secondRoundSettled !== 0) {
    found.push({
      rule: "settlement.second-idempotent",
      mode: "settlement",
      detail: `الجولةُ الثانيةُ حسمَت ${String(facts.secondRoundSettled)}: تسويةٌ مكرَّرةٌ — أثرٌ ماليٌّ يُضاعِفُ.`,
    });
  }
  if (facts.rowStillStaleAfterSettlement) {
    found.push({
      rule: "settlement.row-closed",
      mode: "settlement",
      detail: "المعاملةُ المحسومةُ ما زالت تُرشَّحُ للمراجعةِ: صفٌّ لا يُغلقُ يعيدُ السؤالَ إلى الأبدِ.",
    });
  }
  if (facts.rowStatus !== "active") {
    found.push({
      rule: "settlement.row-active",
      mode: "settlement",
      detail: `الصفُّ بعدَ التسويةِ «${facts.rowStatus}» لا «active»: الدفعةُ محسومةٌ والصفُّ لا يقولُها.`,
    });
  }
  if (facts.ledgerEntries !== 1) {
    found.push({
      rule: "settlement.ledger-once",
      mode: "settlement",
      detail: `${String(facts.ledgerEntries)} قيداً في دفترِ الأستاذِ لدفعٍ واحدٍ: قيدانِ مالٌ مضاعَفٌ، وصفرٌ دفعٌ مفقودٌ.`,
    });
  }
  if (facts.subscriptionActiveCount !== 1) {
    found.push({
      rule: "settlement.subscription-once",
      mode: "settlement",
      detail: `${String(facts.subscriptionActiveCount)} اشتراكًا فعّالًا للسائقِ بعدَ دفعٍ واحدٍ: التفعيلُ يُبدَّلُ لا يُجمَعُ (activate_subscription).`,
    });
  }
  return found;
}

/** حقائقُ الويبهوكِ أثناءَ العطلِ — الفشلُ قبلَ أيِّ أثرٍ ماليٍّ. */
export interface WebhookOutageFacts {
  readonly mode: PaymentOutageMode;
  /** رمزُ حالةِ HTTPِ الذي ردَّ بها مسارُ الويبهوكِ. */
  readonly httpStatus: number;
  readonly rowStatus: string;
  readonly ledgerEntries: number;
  readonly subscriptionActive: boolean;
  readonly webhookEventsStored: number;
}

/** يحكمُ على ويبهوكٍ وصلَ أثناءَ العطلِ: رفضٌ صادقٌ قابلٌ للإعادةِ، لا كتابةَ ولا فسادَ. */
export function judgeWebhookOutage(facts: WebhookOutageFacts): readonly PaymentOutageViolation[] {
  const found: PaymentOutageViolation[] = [];
  const { mode } = facts;
  if (facts.httpStatus !== 503) {
    found.push({
      rule: "webhook.503",
      mode,
      detail: `الويبهوكُ أثناءَ العطلِ ردَّ ${String(facts.httpStatus)}: الرفضُ يجبُ أن يكونَ 503 كي يُعيدَ المزوّدُ الإرسالَ (SEC-07: دفعةٌ مفقودةٌ مالٌ لا طلبٌ).`,
    });
  }
  if (facts.rowStatus !== "pending") {
    found.push({
      rule: "webhook.row-stays-pending",
      mode,
      detail: `الصفُّ صارَ «${facts.rowStatus}» بويبهوكٍ فاشلٍ: الفشلُ المعزولُ لا يُغلِقُ معاملةً.`,
    });
  }
  if (facts.ledgerEntries !== 0) {
    found.push({
      rule: "webhook.no-ledger",
      mode,
      detail: `${String(facts.ledgerEntries)} قيداً بويبهوكٍ فاشلٍ: لا حركةً ماليّةً قبلَ قراءةٍ ناجحةٍ من خادمِ المزوّدِ.`,
    });
  }
  if (facts.subscriptionActive) {
    found.push({
      rule: "webhook.no-activation",
      mode,
      detail: "اشتراكٌ فعّالٌ بويبهوكٍ فاشلِ القراءةِ: تفعيلٌ بلا تحقُّقٍ.",
    });
  }
  if (facts.webhookEventsStored !== 0) {
    found.push({
      rule: "webhook.no-event-stored",
      mode,
      detail: `${String(facts.webhookEventsStored)} حدثاً خُزِّنا لويبهوكٍ لم يُقبل: الحدثُ لا يُسجَّلُ مقبولاً قبلَ حسمِهِ.`,
    });
  }
  return found;
}
