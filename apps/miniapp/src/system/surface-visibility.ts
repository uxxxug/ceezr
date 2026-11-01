/**
 * الغرض: «هل يرى المستخدمُ الشاشةَ الآن؟» — حكمٌ واحدٌ لإيصالاتِ الاستلام (ADR 0296).
 * الحالة: منفّذ فعلياً — 2026-11-01.
 * ينتمي إلى: apps/miniapp/src/system
 * يُستخدم من: surfaces/driver/offers/OffersScreen.tsx · surfaces/rider/active/ActiveRideScreen.tsx
 *
 * ## لماذا
 *
 * إيصالُ اللوحِ (`/v1/driver/offers/receipts`) وإقرارُ أحداثِ الرحلةِ يُغلقانِ صفَّ الإشعارِ
 * **بلا بطاقةِ تيليجرام**. فإن أُرسِلا والـMini App مصغَّرةٌ أو الهاتفُ مقفلٌ (Android يُبقي
 * الـWebView حيًّا) سكتَ الهاتفُ وفاتَ السائقَ طلبٌ. فالإيصالُ لا يُرسَلُ إلّا والصفحةُ
 * ظاهرة؛ وإلّا فالبوتُ يُرسِلُ البطاقةَ بعدَ مهلةِ الانتظارِ المسقوفةِ كما يفعلُ لغيرِ المتصل.
 *
 * بلا `document` (اختباراتُ bun) يُعَدُّ السطحُ ظاهرًا فيبقى السلوكُ المختبَرُ كما هو.
 */
export interface VisibilitySource {
  readonly visibilityState?: string;
}

export function isSurfaceVisible(
  source: VisibilitySource | undefined = typeof document === "undefined" ? undefined : document,
): boolean {
  if (source === undefined) return true;
  return source.visibilityState === undefined || source.visibilityState === "visible";
}
