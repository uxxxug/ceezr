/**
 * الغرض: تصنيفُ فشلِ نداءاتِ عناصرِ [B] (UI-3 / PR 5 · ADR 0238) — **حكمٌ واحدٌ** يقولُ أيَّ
 *   حالٍ يُرسَم: «غيرُ متاحٍ» (503 أو مسارٌ لا يُخدَم) · «الجلسة» (401) · «خطأٌ» يُعادُ.
 * الحالة: منفّذ فعلياً — UI-3 / PR 5.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/settings
 * يُستخدم من: لوحاتُ [B] — جهةُ اتّصالِ الطوارئ · الأماكنُ المحفوظة · تفضيلاتُ الإشعارات · رسائلُ التذكرة.
 *
 * ## القاعدة (Canonical Directive §11 PR 5 «حالات 503 لكل [B]»)
 *
 * الخادمُ يُعيدُ 503 برمزِ `*_NOT_AVAILABLE` حينَ لا مخزنَ مهيّأ، ولا يُركِّبُ المسارَ أصلاً حينَ لا
 * تبعيّةَ (فيصلُ 404 بلا رمزٍ = `HTTP_ERROR`). كلاهما **غيرُ متاحٍ**: الوظيفةُ لا تعملُ الآن، فلا
 * يُعرَضُ حقلٌ يُملأُ ولا يُحفَظ، ولا نجاحٌ لم يقُلْه الخادم. ولا تخترعُ هذه الدالّةُ endpoint.
 */

export type CapabilityFailure =
  | { readonly kind: "unavailable" }
  | { readonly kind: "session" }
  | { readonly kind: "error"; readonly code: string };

function field(thrown: unknown, name: string): unknown {
  if (thrown !== null && typeof thrown === "object" && name in thrown) {
    return (thrown as Record<string, unknown>)[name];
  }
  return undefined;
}

/** رمزُ الخطأِ كما جاءَ — أو `NETWORK` لِما لم يصلْه ردّ، أو `UNKNOWN`. */
export function failureCode(thrown: unknown): string {
  const code = field(thrown, "code");
  if (typeof code === "string" && code.length > 0) return code;
  if (thrown instanceof Error && thrown.name === "ApiNetworkError") return "NETWORK";
  return "UNKNOWN";
}

export function classifyCapabilityFailure(thrown: unknown): CapabilityFailure {
  const status = field(thrown, "status");
  const code = failureCode(thrown);
  if (status === 503 || code.endsWith("_NOT_AVAILABLE")) return { kind: "unavailable" };
  // مسارٌ لم يُركَّبْ: 404 بلا رمزٍ من التطبيق — لا «غيرُ موجودٍ» لعنصرٍ بعينِه.
  if (status === 404 && code === "HTTP_ERROR") return { kind: "unavailable" };
  if (status === 401 || code.startsWith("SESSION_")) return { kind: "session" };
  return { kind: "error", code };
}
