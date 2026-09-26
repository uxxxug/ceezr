/**
 * الغرض: حَكَمٌ خالصٌ لسلوكِ التطبيقِ المصغَّرِ حينَ يتوقَّفُ Bot API لتيليجرام
 *   (`F11-05` — الشقُّ المملوكُ للمستودَعِ): **جلسةُ Waslah الداخليّةُ القائمةُ
 *   تستمرُّ، ومساراتُ Mini App بعدَ المصادقةِ لا تنتظرُ Bot API، وفشلُ الإشعارِ
 *   معزولٌ ومرئيٌّ**.
 * الحالة: منفّذ فعلياً — يُستدعى من اختبارِ التكاملِ على السِلكِ.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: tests/integration/telegram-outage-miniapp.test.ts (الحقائقُ المقيسةُ) ·
 *   tests/unit/telegram-outage-judge.test.ts (السالباتُ المبذورةُ · `ح-7`)
 * الحاكم: docs/adr/0198-telegram-bot-api-outage-does-not-block-miniapp.md
 *
 * ## لماذا حَكَمٌ خالصٌ لا توكيداتٌ مبثوثةٌ في الاختبارِ
 *
 * لأنَّ التوكيدَ الذي لا يُقاسُ بسالبةٍ مبذورةٍ قد يكونُ أخضرَ وهوَ معطوبٌ: اختبارُ
 * تكاملٍ يمرُّ لأنَّ المسارَ يعملُ **لسببٍ آخرَ** (المُرسِلُ صامتٌ لا فاشلٌ) يُقرأُ
 * «صمدَ أمامَ العطلِ» وهوَ لم يحاولِ الإرسالَ أصلاً. فالحَكَمُ يشترطُ **الفشلَ
 * الفعليَّ** للمُرسِلِ (القاطعُ مفتوحٌ · الرفضُ موثَّقٌ) لا غيابَ الخطأِ وحدَه.
 *
 * ## وما لا يحكمُ به عن قصدٍ
 *
 * ــ **لا يحكمُ على `TG-004`/`ARCH-014`**: هذان بندانِ منفصلانِ يتطلّبانِ مصادقةً
 *    بديلةً ونشراً حيًّا (`DEC-07`). والمقيسُ ههنا عزلُ عطلِ Bot API عن مساراتِ
 *    Mini App بعدَ المصادقةِ، لا حلَّ الاعتمادَ على تيليجرام للدخولِ.
 * ــ **لا يحكمُ على إنتاجيّةِ الإشعاراتِ**: الإنتاجيّةُ موضعُها `F9`/`F10`،
 *    والقياسُ ههنا رحلةٌ واحدةٌ تحتَ عطلٍ محقونٍ.
 * ــ **لا يحكمُ على `outbox`**: الإشعاراتُ تُختبرُ عبرَ المُرسِلِ المُحقونِ على
 *    السِلكِ، لا عبرَ صفوفِ `notification_outbox` — فالعزلُ مقيسٌ لا الانتظارُ.
 */

/** نتيجةُ نداءِ مسارِ Mini App واحدٍ أثناءَ عطلِ Bot API. */
export interface MiniAppCallFacts {
  /** المسارُ المُستدعى — `GET /v1/me` مثلًا. */
  readonly endpoint: string;
  /** رمزُ حالةِ HTTP المُعادُ. */
  readonly httpStatus: number;
  /** هل الجلسةُ صالحةٌ عندَ النداءِ؟ */
  readonly sessionValid: boolean;
}

/** لقطةُ الحالةِ التجاريّةِ قبلَ وبعدَ العطلِ. */
export interface CommercialSnapshot {
  /** عددُ الطلباتِ للراكبِ. */
  readonly ordersCount: number;
  /** هل توجدُ رحلةٌ نشطةٌ؟ */
  readonly activeRideExists: boolean;
  /** عددُ العروضِ المعلَّقةِ. */
  readonly pendingOffersCount: number;
}

/** حالةُ المُرسِلِ الصادرِ إلى تيليجرام. */
export interface TelegramSenderState {
  /** حالةُ القاطعِ: `closed` قبلَ العطلِ، `open` بعده. */
  readonly breakerState: "closed" | "open" | "half-open";
  /** عددُ محاولاتِ الإرسالِ الفاشلةِ. */
  readonly failedAttempts: number;
  /** هل رُفِضَ النداءُ بالقاطعِ (`TelegramGuardRejection`)؟ */
  readonly guardRejected: boolean;
  /** رسالةُ الخطأِ إن وُجِدَت. */
  readonly failureReason: string | null;
}

/** الحقائقُ الكاملةُ للقياسِ. */
export interface TelegramOutageFacts {
  /** مساراتُ Mini App قبلَ العطلِ (الخطُّ الأساسُ). */
  readonly baseline: readonly MiniAppCallFacts[];
  /** مساراتُ Mini App أثناءَ العطلِ. */
  readonly duringOutage: readonly MiniAppCallFacts[];
  /** حالةُ المُرسِلِ أثناءَ العطلِ. */
  readonly senderState: TelegramSenderState;
  /** الحالةُ التجاريّةُ قبلَ العطلِ. */
  readonly commercialBefore: CommercialSnapshot;
  /** الحالةُ التجاريّةُ بعدَ العطلِ. */
  readonly commercialAfter: CommercialSnapshot;
}

export interface TelegramOutageViolation {
  readonly rule: string;
  readonly detail: string;
}

/**
 * يحكمُ على عزلِ عطلِ Bot API عن مساراتِ Mini App. دالّةٌ خالصةٌ: حقائقُ تدخلُ
 * وحكمٌ يخرجُ.
 */
export function judgeTelegramOutage(
  facts: TelegramOutageFacts,
): readonly TelegramOutageViolation[] {
  const found: TelegramOutageViolation[] = [];

  // ١ — مساراتُ Mini App كلُّها تُجيبُ 200 أثناءَ العطلِ.
  for (const call of facts.duringOutage) {
    if (call.httpStatus !== 200) {
      found.push({
        rule: "miniapp.api-reachable",
        detail: `${call.endpoint} ردَّ ${String(call.httpStatus)} أثناءَ عطلِ Bot API: عطلُ قناةٍ تكميليّةٍ أسقطَ مسارًا لا يعتمدُ عليها.`,
      });
    }
  }

  // ٢ — الجلسةُ تبقى صالحةً طوالَ العطلِ.
  for (const call of facts.duringOutage) {
    if (!call.sessionValid) {
      found.push({
        rule: "miniapp.session-valid",
        detail: `${call.endpoint}: الجلسةُ سقطَت أثناءَ عطلِ Bot API — جلسةُ Waslah الداخليّةُ لا تعتمدُ على Bot API.`,
      });
    }
  }

  // ٣ — الخطُّ الأساسُ ناجحٌ (سالبٌ: لو فشلَ قبلَ العطلِ فالعطبُ في الاختبارِ لا في العزلِ).
  for (const call of facts.baseline) {
    if (call.httpStatus !== 200) {
      found.push({
        rule: "miniapp.baseline-healthy",
        detail: `${call.endpoint} فشلَ قبلَ العطلِ برمزِ ${String(call.httpStatus)}: الخطُّ الأساسُ معطوبٌ فالقياسُ لا قيمةَ له.`,
      });
    }
  }

  // ٤ — الحالةُ التجاريّةُ لا تتغيَّرُ بالعطلِ.
  if (
    facts.commercialBefore.ordersCount !== facts.commercialAfter.ordersCount ||
    facts.commercialBefore.activeRideExists !== facts.commercialAfter.activeRideExists ||
    facts.commercialBefore.pendingOffersCount !== facts.commercialAfter.pendingOffersCount
  ) {
    found.push({
      rule: "commercial.state-intact",
      detail: `الحالةُ التجاريّةُ تغيَّرَت بالعطلِ: الطلباتُ ${String(facts.commercialBefore.ordersCount)}→${String(facts.commercialAfter.ordersCount)} · الرحلةُ النشطةُ ${String(facts.commercialBefore.activeRideExists)}→${String(facts.commercialAfter.activeRideExists)} · العروضُ ${String(facts.commercialBefore.pendingOffersCount)}→${String(facts.commercialAfter.pendingOffersCount)}.`,
    });
  }

  // ٥ — المُرسِلُ فشلَ فعلًا (سالبٌ: لو لم يُحاولِ الإرسالَ فالعزلُ غيرُ مُختبَرٍ).
  if (facts.senderState.failedAttempts === 0 && !facts.senderState.guardRejected) {
    found.push({
      rule: "sender.actually-failed",
      detail: "لم يُحاولِ المُرسِلُ الإرسالَ أو لم يُسجَّلْ فشلٌ: العزلُ غيرُ مُختبَرٍ.",
    });
  }

  // ٦ — القاطعُ افتُتحَ بعدَ تكرارِ الفشلِ.
  if (facts.senderState.breakerState !== "open") {
    found.push({
      rule: "breaker.opened",
      detail: `القاطعُ ${facts.senderState.breakerState} لا open: تكرارُ الفشلِ لم يفتحِ القاطعَ، فالعطلُ قد يتتال.`,
    });
  }

  // ٧ — سببُ الفشلِ موثَّقٌ لا مسكوتٌ عنه.
  if (facts.senderState.failureReason === null) {
    found.push({
      rule: "sender.failure-visible",
      detail: "سببُ فشلِ الإرسالِ غيرُ موثَّقٍ: الفشلُ الصامتُ ليسَ عزلًا بل إخفاءً.",
    });
  }

  return found;
}
