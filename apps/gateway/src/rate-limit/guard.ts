/**
 * الغرض: جوابُ التجاوزِ الموحَّدُ (`429` معَ `Retry-After`) ومفتاحُ العنوانِ —
 *   موضعٌ واحدٌ يستوردُه كلُّ مَن يَحُدُّ (`SEC-07`).
 * الحالة: منفّذ فعلياً — `SEC-07` (ADR 0139).
 * ينتمي إلى: apps/gateway/src/rate-limit
 * يُستخدَمُ من: `routes/telegram-webhook.ts` · `routes/driver-location.ts` ·
 *   `routes/session-telegram.ts` · `routes/session-refresh.ts` ·
 *   `routes/payment-webhook.ts` · `routes/core-event-intake.ts` ·
 *   `routes/public-tracking.ts`
 * يحرسُه: `tests/unit/rate-limit-enforced.test.ts` (سلوكٌ لا وجودٌ)
 * الحاكم: `docs/adr/0139-an-unlisted-exposed-route-is-an-unlimited-route.md`
 *
 * ## لِمَ يُنقَلُ جوابُ سطرينِ إلى ملفٍّ
 *
 * لأنَّه **كانَ خاصّاً في `telegram-webhook.ts`**، فحينَ حُدَّ `POST
 * /v1/driver/location` كُتِبَ له جوابُ `429` **بلا `Retry-After`** — عميلٌ يُرَدُّ
 * ولا يُخبَرُ متى يعودُ فيُعيدُ فوراً، أي حدٌّ يُنتِجُ الحِمْلَ الذي يمنعُه. ونسخةٌ
 * ثانيةٌ من جوابٍ ليسَت تكراراً بل **فرصةَ اختلافٍ صامتٍ**، وقد وقعَ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 * - **لا يَحُدُّ**: العدُّ في `fixed-window.ts`، والقرارُ في المسارِ. وههنا شكلُ
 *   الجوابِ وحدَه — ومَن استوردَه لم يُصبِحْ محدوداً بذلك.
 * - **لا يقرأُ هويّةً من العنوانِ**: `clientAddress` مفتاحُ عدٍّ لا هويّةٌ، والقيمةُ
 *   مُنتحَلةٌ بطبيعتِها فلا يُبنى عليها إذنٌ.
 */

import type { RateDecision } from "./fixed-window.ts";

/** شكلُ الجوابِ — مُعلَنٌ نصّاً كي يُقاسَ في الاختبارِ لا يُوصَفَ. */
export const RATE_LIMITED_BODY = { ok: false, error: "RATE_LIMITED" } as const;
export const RATE_LIMITED_STATUS = 429 as const;
export const RETRY_AFTER_HEADER = "retry-after";

/**
 * جوابٌ موحَّدٌ للتجاوزِ: `429` معَ `Retry-After` كي يعرفَ المُرسِلُ متى يعودُ.
 * **والرأسُ ليسَ تجميلاً**: بدونَه يُعيدُ العميلُ فوراً فيُصبِحُ الحدُّ مُضاعِفاً
 * للحِمْلِ لا مانعاً له.
 */
export function tooManyRequests(
  c: {
    json: (body: unknown, status: 429, headers: Record<string, string>) => Response;
  },
  resetSeconds: number,
): Response {
  return c.json(RATE_LIMITED_BODY, RATE_LIMITED_STATUS, {
    [RETRY_AFTER_HEADER]: String(Math.max(1, Math.ceil(resetSeconds))),
  });
}

/**
 * قرارٌ غيرُ مسموحٍ؟ فجوابُ التجاوزِ. و`undefined` تعني **لا حاصرَ مُركَّباً** فيمرُّ
 * الطلبُ: التدهورُ مُعلَنٌ في السِجلِّ لا مُخفىً في شرطٍ.
 */
export function rateLimitRejection(
  c: {
    json: (body: unknown, status: 429, headers: Record<string, string>) => Response;
  },
  decision: RateDecision | undefined,
): Response | null {
  if (decision === undefined || decision.allowed) return null;
  return tooManyRequests(c, decision.resetSeconds);
}

/**
 * عنوانُ المُرسِلِ خلفَ وسيطٍ. أوّلُ قيمةٍ في `x-forwarded-for` هيَ العميلُ وما
 * بعدَها الوسطاءُ. **والقيمةُ مُنتحَلةٌ بطبيعتِها**، فلا يُبنى عليها إلّا عدٌّ — لا
 * صلاحيةٌ ولا هويّةٌ.
 */
export function clientAddress(header: string | undefined): string {
  const first = (header ?? "").split(",")[0]?.trim() ?? "";
  return first === "" ? "unknown" : first;
}
