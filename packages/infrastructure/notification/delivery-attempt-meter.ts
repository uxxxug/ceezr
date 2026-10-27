/**
 * `LOAD-01` (تفكيكُ P7) — عدّادُ محاولةِ تسليمٍ واحدة.
 *
 * محاولةُ تسليمِ صفٍّ من صندوقِ الصادرِ تمرُّ بالمُرسِلِ المرِن (`rate-aware-telegram-sender`)،
 * وفيه يُنتظَرُ دلوُ المحادثةِ والدلوُ العالميُّ (حدُّ تيليجرام المحميُّ)، ويُرمى ازدحامٌ،
 * ويُنادى تيليجرام. لم يكنْ شيءٌ من ذلك مربوطًا بالصفِّ: أحداثُ `outbound.resilience_event`
 * تحملُ المحادثةَ لا الصفّ. هذا العدّادُ يُفتَحُ حولَ المحاولةِ (`AsyncLocalStorage`) فيجمعُ
 * المُرسِلُ فيه أرقامَه، ويقرؤُها العاملُ عندَ إعلانِ المحاولة.
 *
 * - خارجَ محاولةٍ مقيسةٍ لا عدّادَ (`currentAttemptMeter()` = `undefined`) ولا كلفةَ
 *   إلّا قراءةَ السياق؛ فالمسارُ الإنتاجيُّ المُطفأُ القياسِ لا يتغيّر.
 * - أرقامٌ فقط: لا محادثةَ ولا نصَّ خطأٍ ولا رمز.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface DeliveryAttemptMeter {
  /** نداءاتُ `bucket.acquire` (Redis/الذاكرة) وزمنُها — كلفةُ السؤالِ لا الانتظار. */
  acquireCalls: number;
  acquireMs: number;
  /** نومٌ متعمَّدٌ لانتظارِ فتحةِ دلوِ المحادثة (1/ث للمحادثة). */
  chatWaitMs: number;
  chatWaits: number;
  /** نومٌ متعمَّدٌ لانتظارِ فتحةِ الدلوِ العالميّ (25/ث للبوت). */
  globalWaitMs: number;
  globalWaits: number;
  /** رفضُ الانتظارِ لتجاوزِ الميزانيّة (`congestion: "abort"`) ⇒ `OutboundCongestionError`. */
  congestionAborts: number;
  congestionScope: "chat" | "global" | null;
  congestionRetryAfterMs: number;
  /** نداءُ تيليجرام الفعليّ (بمهلتِه). */
  apiCalls: number;
  apiMs: number;
  /** 429 من تيليجرام ونومُ احترامِه. */
  throttled: number;
  throttleWaitMs: number;
  /** إعادةٌ عابرةٌ داخلَ المُرسِلِ ونومُ تراجعِها. */
  retries: number;
  retryWaitMs: number;
}

export function emptyDeliveryAttemptMeter(): DeliveryAttemptMeter {
  return {
    acquireCalls: 0,
    acquireMs: 0,
    chatWaitMs: 0,
    chatWaits: 0,
    globalWaitMs: 0,
    globalWaits: 0,
    congestionAborts: 0,
    congestionScope: null,
    congestionRetryAfterMs: 0,
    apiCalls: 0,
    apiMs: 0,
    throttled: 0,
    throttleWaitMs: 0,
    retries: 0,
    retryWaitMs: 0,
  };
}

const storage = new AsyncLocalStorage<DeliveryAttemptMeter>();

/** يُشغِّلُ `run` بعدّادٍ جديدٍ ويُعيدُ نتيجتَه؛ العدّادُ مقروءٌ داخلَه بـ`currentAttemptMeter`. */
export function runWithDeliveryAttemptMeter<T>(
  meter: DeliveryAttemptMeter,
  run: () => Promise<T>,
): Promise<T> {
  return storage.run(meter, run);
}

export function currentAttemptMeter(): DeliveryAttemptMeter | undefined {
  return storage.getStore();
}

/** تقريبٌ إلى ميلي ثانيةٍ صحيحةٍ للسجلّ. */
export function deliveryAttemptMeterFields(
  m: DeliveryAttemptMeter,
): Record<string, number | string | null> {
  const r = (x: number) => Math.round(x);
  return {
    acquire_calls: m.acquireCalls,
    acquire_ms: r(m.acquireMs),
    chat_wait_ms: r(m.chatWaitMs),
    chat_waits: m.chatWaits,
    global_wait_ms: r(m.globalWaitMs),
    global_waits: m.globalWaits,
    congestion_aborts: m.congestionAborts,
    congestion_scope: m.congestionScope,
    congestion_retry_after_ms: r(m.congestionRetryAfterMs),
    api_calls: m.apiCalls,
    api_ms: r(m.apiMs),
    throttled: m.throttled,
    throttle_wait_ms: r(m.throttleWaitMs),
    retries: m.retries,
    retry_wait_ms: r(m.retryWaitMs),
  };
}
