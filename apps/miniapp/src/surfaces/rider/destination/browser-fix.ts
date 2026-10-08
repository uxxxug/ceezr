/**
 * قراءةُ المتصفّحِ وحدَها — `LOC-TRUST-01`. منفصلةٌ عن `device-fix.ts` كي تُختبَرَ بلا مُضيفِ
 * Telegram ولا DOM (لا تستوردُ `tg/`). القواعدُ في رأسِ `device-fix.ts`.
 */
export interface DeviceFix {
  readonly ok: true;
  readonly lat: number;
  readonly lng: number;
  /** نصفُ قطرِ الدقّةِ بالمتر؛ `null` = لم يُعلِنْه المصدر. */
  readonly accuracyM?: number | null;
  /** طابعُ الالتقاطِ من المصدرِ (ms)؛ `null` = لا طابعَ (حداثةٌ غيرُ مُثبَتة). */
  readonly capturedAtMs?: number | null;
}

export type DeviceFixResult = DeviceFix | { readonly ok: false; readonly reason: string };

/** مهلةُ المتصفّح: أقصرُ من مهلةِ Telegram (45 ث) كي يبقى البديلُ في وقتٍ يُحتمَل. */
export const BROWSER_FIX_TIMEOUT_MS = 12_000;

interface GeoLike {
  getCurrentPosition(
    success: (position: {
      readonly coords: { latitude: number; longitude: number; accuracy: number };
      readonly timestamp: number;
    }) => void,
    failure: (error: { readonly code: number }) => void,
    options: { enableHighAccuracy: boolean; maximumAge: number; timeout: number },
  ): void;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** قراءةُ المتصفّح — `null` حينَ لا قراءة (فيُجرَّبُ Telegram). */
export function readBrowserFix(
  geo: GeoLike | undefined = (globalThis as { navigator?: { geolocation?: GeoLike } }).navigator
    ?.geolocation,
): Promise<DeviceFix | null> {
  if (geo === undefined || typeof geo.getCurrentPosition !== "function") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: DeviceFix | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    // حارسٌ ثانٍ فوقَ `timeout` المتصفّح: WebView لا يُظهِرُ نافذةَ إذنٍ قد لا يُجيبُ أبداً.
    const timer = setTimeout(() => finish(null), BROWSER_FIX_TIMEOUT_MS + 1_000);
    try {
      geo.getCurrentPosition(
        (position) => {
          const lat = finite(position.coords.latitude);
          const lng = finite(position.coords.longitude);
          if (lat === null || lng === null) return finish(null);
          finish({
            ok: true,
            lat,
            lng,
            accuracyM: finite(position.coords.accuracy),
            capturedAtMs: finite(position.timestamp),
          });
        },
        () => finish(null),
        { enableHighAccuracy: true, maximumAge: 0, timeout: BROWSER_FIX_TIMEOUT_MS },
      );
    } catch {
      finish(null);
    }
  });
}
