/**
 * Waslah internal session — client-side holder only.
 * Session is issued by the server after HMAC verification of Telegram initData
 * (ROADMAP §9.8, ADR 0035 path: Bot → Mini App → verify → Waslah Session → API).
 *
 * F1-01: holder + types only. Exchange endpoint is F1-03 / F1-04.
 * Mini App MUST NOT invent users or domain sessions (ADR 0035).
 *
 * F1-04 — سياسةُ التخزين، وهي التي تفسّر شكلَ هذا النوعِ اليوم:
 *   ــ **رمزُ الوصولِ في الذاكرةِ وحدَها**: يموت بإغلاقِ التطبيقِ ولا يُكتَب مكاناً.
 *   ــ **رمزُ التجديدِ ليس في هذا الحاملِ إطلاقاً**: موضعُه `SecureStorage` وحدَه
 *      عبرَ `session-storage.ts`. وكان في `F1-01` حقلاً ههنا قبلَ أن تُحسَم
 *      السياسة؛ وحُذِف في `F1-04` لأنّ حقلاً في الحاملِ يُقرأ من كلِّ شاشةٍ ويُمرَّر
 *      في كلِّ كائنٍ ويُطبَع في أوّلِ سطرِ تشخيص — وحصرُه في مخزنٍ واحدٍ سياسةٌ
 *      مُنفَّذةٌ لا موصوفة.
 */

import { type DeviceSecureStore, forgetRefreshToken } from "./session-storage.ts";

export type WaslahSession = {
  /** رمزُ الوصولِ — في الذاكرةِ وحدَها (`F1-04`). */
  accessToken: string;
  expiresAt: number;
  role: "rider" | "driver" | "admin" | "unknown";
};

let current: WaslahSession | null = null;

export function getSession(): WaslahSession | null {
  return current;
}

export function setSession(session: WaslahSession | null): void {
  current = session;
}

export function hasValidSession(now = Date.now()): boolean {
  return current !== null && current.expiresAt > now;
}

/**
 * Clear local holder only.
 *
 * **حدٌّ معلَن (`F1-04`)**: لا إبطالَ على الخادم. التصميمُ بلا حالةٍ ولا مخزنَ
 * جلسات، فلا مسارَ إبطالٍ يُنادى. ورمزٌ خرج من الجهازِ قبلَ المسحِ يبقى صالحاً
 * حتى انتهائِه أو حتى سقفِ الجلسةِ المطلق. وهذا ما يحمي: قِصَرُ العمرِ والسقف.
 */
export function clearSession(): void {
  current = null;
}

/**
 * خروجُ المستخدم (`F1-04`): يمسح رمزَ الوصولِ من الذاكرةِ **و**رمزَ التجديدِ من
 * التخزينِ الآمن. ولا يزعم إبطالاً على الخادمِ — انظر `clearSession`.
 */
export async function logoutSession(store?: DeviceSecureStore): Promise<void> {
  clearSession();
  await (store === undefined ? forgetRefreshToken() : forgetRefreshToken(store));
}
