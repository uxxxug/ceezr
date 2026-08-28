/**
 * الغرض: سياسةُ تخزينِ الجلسةِ على الجهازِ (`F1-04`) — **رمزُ التجديدِ في
 *   `SecureStorage` وحدَه، ورمزُ الوصولِ في الذاكرةِ وحدَها**. وهذا الملفُّ هو
 *   موضعُ السياسةِ الوحيد؛ أمّا `tg/storage.ts` فمُغلِّفٌ بلا سياسة (`F1-02`).
 * الحالة: منفّذ فعلياً — البند `F1-04`.
 * ينتمي إلى: apps/miniapp/src/identity
 * يُتوقع أن يستخدمه لاحقاً: `renew.ts` و`session.ts` وشاشاتُ الدخولِ في `F1-05`.
 * ملاحظات مستقبلية: لا يُضاف مفتاحٌ ثانٍ ههنا بلا بندٍ صريح، ولا يُخزَّن رمزُ
 *   وصولٍ ولا معرّفُ مستخدمٍ ولا دورٌ على الجهاز.
 *
 * قواعدُ صارمةٌ يفرضها `scripts/check-session-storage-policy.ts` على البناء:
 *   ــ **لا `CloudStorage`**: مزامَنةُ تيليجرامَ تنقل القيمةَ بين الأجهزة، والقسم
 *      4.4 يقصر `CloudStorage` على تفضيلاتٍ غيرِ حسّاسة. ورمزُ الجلسةِ «للجهازِ فقط».
 *   ــ **لا `DeviceStorage`**: تخزينٌ على الجهازِ غيرُ مُعَمًّى بالمنصّة.
 *   ــ **لا `localStorage` ولا `sessionStorage` ولا كوكيز**: ولا تراجعَ إليها عندَ
 *      غيابِ `SecureStorage` — التراجعُ إلى تخزينٍ أضعفَ يُبطِل السياسةَ ويُبقي
 *      اسمَها. وعندَ الغيابِ تبقى الجلسةُ **في الذاكرةِ وحدَها** وتُغلَق بإغلاقِ
 *      التطبيق: نقصٌ في الراحةِ لا في الأمان.
 *   ــ **لا كتابةَ رمزٍ في مسارٍ ولا في `query` ولا في سجلٍّ ولا في قياسات**.
 */

import type { TgOutcome, TgSecureRead, TgUnavailableReason } from "../tg/index.ts";
import { secureStorageGet, secureStorageRemove, secureStorageSet } from "../tg/index.ts";

/**
 * مفتاحٌ واحدٌ لا أكثر. واسمُه لا يقول «token» صريحاً في مخزنٍ قد يُعرَض في
 * أدواتِ تشخيصٍ، وإن كان هذا حجاباً بالاسمِ لا حمايةً — الحمايةُ من المنصّةِ نفسِها.
 */
export const REFRESH_TOKEN_STORAGE_KEY = "waslah.session.renewal";

/**
 * منفذُ التخزينِ الآمنِ على الجهاز — ثلاثُ عملياتٍ لا أكثر، ومحوّلُه الوحيدُ في
 * الإنتاجِ هو طبقةُ تغليفِ تيليجرام. وُجِد المنفذُ لسببَين: أنّ اختبارَ السياسةِ لا
 * يحتاج مضيفَ تيليجرامَ ليشهدَ عليها، وأنّ مضيفاً ثانياً (`DEC-07`) يُوصَل يوماً
 * بمحوّلٍ آخرَ بلا تعديلِ السياسةِ نفسِها.
 */
export interface DeviceSecureStore {
  set(key: string, value: string): Promise<TgOutcome<boolean>>;
  get(key: string): Promise<TgOutcome<TgSecureRead>>;
  remove(key: string): Promise<TgOutcome<boolean>>;
}

/** المحوّلُ الوحيدُ في الإنتاج: `SecureStorage` من طبقةِ تيليجرامَ، بلا بديل. */
export const telegramSecureStore: DeviceSecureStore = {
  set: (key, value) => secureStorageSet(key, value),
  get: (key) => secureStorageGet(key),
  remove: (key) => secureStorageRemove(key),
};

/**
 * نتيجةُ محاولةِ الحفظ. `stored: false` **ليست خطأً**: هي الحالةُ العاديةُ على
 * عميلٍ أقدمَ من Bot API 9.0 أو خارجَ تيليجرامَ أصلاً، ويجب أن يفرّعَ عليها
 * النداءُ بلا تراجعٍ إلى تخزينٍ أضعف.
 */
export type RefreshTokenStoreResult =
  | { readonly stored: true }
  | { readonly stored: false; readonly reason: TgUnavailableReason };

/** يحفظ رمزَ التجديدِ في التخزينِ الآمنِ وحدَه. لا تسجيلَ ولا تراجعَ. */
export async function persistRefreshToken(
  token: string,
  store: DeviceSecureStore = telegramSecureStore,
): Promise<RefreshTokenStoreResult> {
  const outcome = await store.set(REFRESH_TOKEN_STORAGE_KEY, token);
  return outcome.ok ? { stored: true } : { stored: false, reason: outcome.reason };
}

/**
 * يقرأ رمزَ التجديدِ إن وُجد. `null` تعني «لا رمزَ صالحَ الاستعمالِ الآن» —
 * سواءٌ غاب المخزنُ أو غاب المفتاحُ: كلاهما يقود العميلَ إلى المسارِ نفسِه
 * (تحقّقٌ جديدٌ من تيليجرام)، فلا فائدةَ في تفريقهما ههنا.
 */
export async function loadRefreshToken(
  store: DeviceSecureStore = telegramSecureStore,
): Promise<string | null> {
  const outcome = await store.get(REFRESH_TOKEN_STORAGE_KEY);
  if (!outcome.ok) return null;
  const value = outcome.value.value;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * يمسح رمزَ التجديدِ من الجهاز. **حدٌّ معلَن**: هذا مسحٌ محليٌّ لا إبطالٌ —
 * الخادمُ بلا حالةٍ (قرارُ `F1-04`)، فرمزٌ خرج من الجهازِ قبلَ المسحِ يبقى صالحاً
 * حتى انتهائِه أو حتى سقفِ الجلسةِ المطلق. ولا يُدَّعى غيرُ ذلك.
 */
export async function forgetRefreshToken(
  store: DeviceSecureStore = telegramSecureStore,
): Promise<RefreshTokenStoreResult> {
  const outcome = await store.remove(REFRESH_TOKEN_STORAGE_KEY);
  return outcome.ok ? { stored: true } : { stored: false, reason: outcome.reason };
}
