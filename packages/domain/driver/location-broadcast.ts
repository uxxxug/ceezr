/**
 * الغرض: قرارُ نبضةِ موقعِ السائقِ — **دالّةٌ نقيّةٌ** تُجيبُ: أبثَّ الآنَ، أم
 *   أنتظرْ كذا، أم توقّفْ ولِمَ (`F3-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-04`.
 * ينتمي إلى: packages/domain/driver
 * يُستخدم من: `apps/miniapp/src/surfaces/driver/location/*`
 * يُتوقع أن يستخدمه لاحقاً: أيُّ بثٍّ آخرَ يُقرَّرُ بسببٍ منشورٍ لا بمؤقّتٍ.
 * يحرسُه: tests/unit/driver-location-broadcast.test.ts ·
 *   scripts/check-location-broadcast-contract.ts
 * الحاكم: docs/adr/0119-a-heartbeat-needs-a-published-reason.md
 *
 * ## لِمَ دالّةٌ نقيّةٌ لا مؤقّتٌ
 *
 * مؤقّتٌ يُختبَرُ بمُهلٍ حقيقيّةٍ يُقاسُ **بطيئاً وغيرَ حاسمٍ**، فتُسكَتُ حالاتُه
 * أو تُصنَّفُ «متقطّعةً». وههنا **الزمنُ مُعطىً** (`nowMs`) والحكمُ مُعادٌ قيمةً،
 * فكلُّ فرعٍ يُقاسُ في مِلّي ثانيةٍ وبلا تخمينٍ: التراجعُ، وسقفُه، والسكونُ
 * لأسبابِه الخمسةِ. **والمؤقّتُ غلافٌ** حولَ هذه الدالّةِ لا صاحبُ الحكمِ.
 *
 * ## وما لا تفعلُه هذه الوحدةُ عن قصدٍ — (`ح-5`)
 *
 * - **لا تقرأُ ساعةً ولا موضعاً ولا شبكةً**: لا `Date.now()` ولا `navigator`
 *   ولا `fetch` — ولو قرأت ساعةً لَصارَ لها حالٌ خفيٌّ ولَتعذَّرَ قياسُها.
 * - **لا تخترعُ مُدّةً**: `intervalSeconds = null` سكونٌ يُطاعُ لا نقصٌ يُكمَّلُ
 *   بافتراضٍ. ومَن يخترعُ افتراضاً ههنا يُنشئُ حُكماً ثانياً في النظامِ.
 * - **لا تحرسُ إسرافاً**: حدُّ المعدَّلِ في البوّابةِ (`F4-01`) هوَ الحاكمُ على
 *   عميلٍ عاصٍ. وهذه سياسةُ **تعاونٍ** لا حراسةٌ، ولا يُدَّعى غيرُ ذلكَ.
 * - **لا تقيسُ بطاريّةً ولا صدقَ موقعٍ في الميدانِ**: كلاهما غيرُ مقيسٍ.
 */

/** مجالُ الأسبابِ مغلقٌ: نصٌّ غريبٌ فيه عطبُ عقدٍ لا حالٌ جديدةٌ تُقبَلُ. */
export const BROADCAST_REASONS = ["AVAILABLE", "TO_PICKUP", "ON_TRIP"] as const;

/** سببُ البثِّ **كما يُنشِرُه الخادمُ** — لا يُشتَقُّ في العميلِ ولا من مسافةٍ. */
export type BroadcastReason = (typeof BROADCAST_REASONS)[number];

export interface BroadcastPolicy {
  /** `null` = لا سببَ للبثِّ ألبتّةَ (لا مَهمّةَ ولا توفُّرَ). */
  readonly reason: BroadcastReason | null;
  /** `null` = **لا تبثَّ**: إمّا لا سببَ، أو إعدادُ المدينةِ غائبٌ (`ADR 0023`). */
  readonly intervalSeconds: number | null;
}

/** حالُ إذنِ الموقعِ كما يقولُه المُضيفُ — أربعُ حقائقَ لا تُخمَّنُ. */
export interface LocationAccess {
  readonly inited: boolean;
  readonly available: boolean;
  readonly accessRequested: boolean;
  readonly accessGranted: boolean;
}

/**
 * سببُ السكونِ. **مُسمّىً لا رمزاً عامّاً**: سائقٌ لا يبثُّ يستحقُّ أن يُقالَ له
 * لِمَ، وفحصٌ يقرأُ السببَ يُميِّزُ «مُنِعَ الإذنُ» من «لا مَهمّةَ» من «إعدادٌ
 * غائبٌ» — وثلاثةٌ تُجمَعُ في رمزٍ واحدٍ تصيرُ عطباً لا يُشخَّصُ.
 */
export type BroadcastStopReason =
  | "NO_REASON_TO_BROADCAST"
  | "INTERVAL_NOT_CONFIGURED"
  | "LOCATION_UNSUPPORTED"
  | "PERMISSION_NOT_GRANTED"
  | "SESSION_LOST"
  | "NOT_A_DRIVER";

export type BroadcastDecision =
  | { readonly kind: "SEND"; readonly reason: BroadcastReason }
  | { readonly kind: "WAIT"; readonly delayMs: number; readonly reason: BroadcastReason }
  | { readonly kind: "STOP"; readonly why: BroadcastStopReason };

/**
 * رفضٌ **لا تُصلِحُه إعادةٌ**: جلسةٌ ساقطةٌ أو مَن ليسَ سائقاً. وإعادةُ المحاولةِ
 * عليهما تكتبُ سجلَّ فشلٍ أبديّاً ولا تُغيِّرُ شيئاً.
 */
export const FATAL_BROADCAST_ERRORS: readonly string[] = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "DRIVER_NOT_REGISTERED",
];

/**
 * سقفُ التراجعِ **بعددِ التضاعُفاتِ لا بثوابتِ ثوانٍ**: نُضاعِفُ حتّى ثمانيةِ
 * أضعافٍ ثمَّ نثبتُ. ولِمَ سقفٌ أصلاً: تضاعُفٌ بلا حدٍّ يجعلُ سائقاً في رحلةٍ
 * يبثُّ مرّةً كلَّ ساعةٍ بعدَ انقطاعٍ عابرٍ، فيصيرُ التراجعُ عطباً صامتاً.
 */
export const MAX_BACKOFF_DOUBLINGS = 3;

/** ضعفُ التراجعِ — مُصدَّرٌ ليُقاسَ وحدَه لا ليُعادَ حسابُه في مكانَينِ. */
export function backoffMultiplier(consecutiveFailures: number): number {
  if (!Number.isFinite(consecutiveFailures) || consecutiveFailures <= 0) return 1;
  const doublings = Math.min(Math.floor(consecutiveFailures), MAX_BACKOFF_DOUBLINGS);
  return 2 ** doublings;
}

export interface BroadcastInput {
  readonly policy: BroadcastPolicy;
  /** لحظةُ الجهازِ **للمُقارنةِ فحسب**: كلُّ فرقٍ ههنا فرقُ لحظتَينِ من ساعةٍ
   *  واحدةٍ، ولا يُقارَنُ بلحظةِ خادمٍ فلا تُحمَلُ ساعةُ الجهازِ حُكماً. */
  readonly nowMs: number;
  /** آخرُ محاولةٍ **أُرسِلَت** (نجحَت أو فشلَت)، أو `null` إن لم تكن بعدُ. */
  readonly lastAttemptAtMs: number | null;
  readonly consecutiveFailures: number;
  readonly access: LocationAccess | null;
  /** آخرُ رمزِ رفضٍ من البوّابةِ، أو `null`. */
  readonly lastError: string | null;
}

/**
 * الحكمُ. وترتيبُ الفحوصِ **مقصودٌ**: القاتلُ أوّلاً، ثمَّ الإذنُ، ثمَّ السببُ،
 * ثمَّ المُدّةُ، ثمَّ الزمنُ. فسائقٌ فقدَ جلستَه لا يُسألُ عن إذنِ موقعٍ، ومَن
 * لا سببَ لبثِّه لا يُطلَبُ إذنُه ألبتّةَ — **ولا يُستَجدى إذنٌ بلا حاجةٍ**.
 */
export function nextBroadcastDecision(input: BroadcastInput): BroadcastDecision {
  const { policy, access } = input;

  if (input.lastError !== null && FATAL_BROADCAST_ERRORS.includes(input.lastError)) {
    return {
      kind: "STOP",
      why: input.lastError === "DRIVER_NOT_REGISTERED" ? "NOT_A_DRIVER" : "SESSION_LOST",
    };
  }

  if (policy.reason === null) return { kind: "STOP", why: "NO_REASON_TO_BROADCAST" };

  if (access === null || !access.available) {
    return { kind: "STOP", why: "LOCATION_UNSUPPORTED" };
  }
  if (!access.accessGranted) return { kind: "STOP", why: "PERMISSION_NOT_GRANTED" };

  if (policy.intervalSeconds === null) {
    return { kind: "STOP", why: "INTERVAL_NOT_CONFIGURED" };
  }

  const intervalMs =
    Math.floor(policy.intervalSeconds * 1000) * backoffMultiplier(input.consecutiveFailures);

  // أوّلُ نبضةٍ **فوراً**: سائقٌ فتحَ شاشتَه ولهُ سببٌ يبثُّ الآنَ لا بعدَ دقيقةٍ.
  if (input.lastAttemptAtMs === null) return { kind: "SEND", reason: policy.reason };

  const dueAtMs = input.lastAttemptAtMs + intervalMs;
  // ساعةٌ رجعَت إلى الوراءِ (تعديلُ منطقةٍ أو مزامنةٌ) تُقرأُ «حانَ الوقتُ» لا
  // «انتظرْ أبداً»: تأخُّرٌ نبضةً واحدةً أهونُ من سكونٍ لا يخرجُ منه العميلُ.
  if (input.nowMs < input.lastAttemptAtMs) return { kind: "SEND", reason: policy.reason };
  if (input.nowMs >= dueAtMs) return { kind: "SEND", reason: policy.reason };

  return { kind: "WAIT", delayMs: dueAtMs - input.nowMs, reason: policy.reason };
}
