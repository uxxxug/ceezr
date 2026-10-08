/**
 * # قراءةُ موقعِ الجهازِ الحديثة — `LOC-TRUST-01`
 *
 * **الغرض:** «استخدم موقعي الحالي» كانَ يقرأُ `LocationManager.getLocation` وحدَه ثمّ يرمي
 * الدقّة. وعلى Telegram لـAndroid يُعيدُ ذلكَ موقعاً **راكداً** لا يتحدّثُ ما لم يُحرِّكْ
 * خدمةَ الموقعِ مصدرٌ آخر (Telegram-Mini-Apps/issues#56)، ولا يحملُ طابعاً زمنيّاً — فظهرَت
 * في PRD-008 نقطةٌ قربَ معلَمٍ بعيدٍ عن الراكبِ ولم يكنْ في الشاشةِ ما يُنذِر.
 *
 * فالترتيبُ هنا (`ADR 0031` §4 يُسمّي واجهةَ المتصفّحِ بديلاً):
 * ١) **`navigator.geolocation` أوّلاً** بـ`maximumAge: 0` و`enableHighAccuracy`: قراءةٌ جديدةٌ
 *    لا مُخبَّأة، ومعها الدقّةُ وطابعُ الالتقاطِ من المصدرِ نفسِه.
 * ٢) إن تعذّرَت (لا واجهةَ · رفضٌ · مهلة) فـTelegram — **ودقّتُه محفوظةٌ** وطابعُه `null`
 *    (حداثةٌ غيرُ مُثبَتة) فلا تبلغُ القراءةُ `GOOD` في سياسةِ `assessDeviceFix` أبداً.
 *
 * **ما لا يفعلُه عن قصد:** لا يُخبِّئُ قراءةً ولا يحفظُها، ولا يكتبُ إحداثيّةً في سجلٍّ أو
 * قياسٍ (لا PII). ولا يختلقُ موقعاً عندَ التعذّر: السببُ يُعادُ كما هو.
 *
 * **الحالة:** منفّذ فعلياً. **ينتمي إلى:** surfaces/rider/destination.
 */
import { initLocation, requestLocation } from "../../../tg/index.ts";
import { type DeviceFixResult, readBrowserFix } from "./browser-fix.ts";

export type { DeviceFix, DeviceFixResult } from "./browser-fix.ts";

/** القراءةُ الافتراضيّة للشاشتين: المتصفّحُ أوّلاً ثمّ Telegram. */
export async function readFreshDeviceFix(): Promise<DeviceFixResult> {
  const browser = await readBrowserFix();
  if (browser !== null) return browser;
  const inited = await initLocation();
  if (!inited.ok) return { ok: false, reason: inited.reason };
  const read = await requestLocation();
  if (!read.ok) return { ok: false, reason: read.reason };
  return {
    ok: true,
    lat: read.value.latitude,
    lng: read.value.longitude,
    accuracyM: read.value.horizontalAccuracy,
    // Telegram لا يُعيدُ طابعاً: لا يُختلَقُ «الآن» — الحداثةُ غيرُ مُثبَتة.
    capturedAtMs: null,
  };
}
