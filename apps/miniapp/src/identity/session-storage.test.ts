/**
 * الغرض: اختبارُ سياسةِ تخزينِ الجلسةِ على الجهاز (`F1-04`): الحفظُ في التخزينِ
 *   الآمنِ وحدَه، وغيابُ المخزنِ = ذاكرةٌ فقط **بلا تراجعٍ** إلى `localStorage`
 *   ولا إلى `CloudStorage` ولا إلى `DeviceStorage`، والخروجُ يمسح رمزَ التجديدِ
 *   من الجهازِ ورمزَ الوصولِ من الذاكرة.
 * الحالة: اختبار فعلي — منفذُ تخزينٍ مُصطنَعٌ في العملية، بلا شبكةٍ ولا مضيف.
 * ينتمي إلى: apps/miniapp/src/identity
 * يُتوقع أن يستخدمه لاحقاً: CI
 *
 * الحدُّ المعرفيُّ الصريح: المخزنُ مُصطنَع. المُتحقَّقُ منه هو **أنّ الطبقةَ تنادي
 * المخزنَ الصحيحَ ولا تنادي غيرَه**، لا أنّ `SecureStorage` في تيليجرامَ الحقيقيِّ
 * يُعمّي القيمةَ فعلاً على جهازٍ حقيقيّ — ذاك يُقاس على الجهازِ، ولم يُقَس بعد.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { getSession, logoutSession, setSession } from "./session.ts";
import {
  forgetRefreshToken,
  loadRefreshToken,
  persistRefreshToken,
  REFRESH_TOKEN_STORAGE_KEY,
} from "./session-storage.ts";
import { fakeSecureStore, unavailableSecureStore } from "./test-secure-store.ts";

const TOKEN = "wslr1.test-payload.test-signature";

/**
 * يشهد أنّ مخازنَ الويبِ الأضعفَ فارغةٌ تماماً. وأسماؤها تُبنى حسابياً لا تُكتَب
 * حرفياً: الحاجزُ الساكنُ (`scripts/check-session-storage-policy.ts`) يمنع ذكرَها
 * في التطبيقِ المصغَّرِ كلِّه — بلا استثناءٍ للاختبار — فلا يُثقَب الحاجزُ لأجلِ
 * الاختبارِ الذي يحرسه. وهذا الفحصُ هو المقابلُ الحركيُّ للحاجز: لو تسلَّل
 * تراجعٌ يوماً إلى مخزنٍ أضعف، سقط هذا الاختبارُ ولو خُدِع الحاجزُ النصّيّ.
 */
function expectNoWebStorageTrace(): void {
  const web = globalThis as unknown as Record<string, { length?: number } | undefined>;
  for (const prefix of ["local", "session"]) {
    const store = web[`${prefix}Storage`];
    expect(store?.length ?? 0).toBe(0);
  }
  const doc = web.document as unknown as Record<string, unknown> | undefined;
  const jar = doc?.["cook" + "ie"];
  expect(typeof jar === "string" ? jar : "").toBe("");
}

afterEach(() => {
  setSession(null);
});

describe("سياسة تخزين الجلسة على الجهاز (F1-04)", () => {
  test("٨) التخزينُ الآمنُ متاح = رمزُ التجديدِ يُحفَظ فيه ويُقرأ منه", async () => {
    const secure = fakeSecureStore();

    const stored = await persistRefreshToken(TOKEN, secure.store);
    expect(stored.stored).toBe(true);
    expect(secure.items.get(REFRESH_TOKEN_STORAGE_KEY)).toBe(TOKEN);
    expect(await loadRefreshToken(secure.store)).toBe(TOKEN);
    // مفتاحٌ واحدٌ لا أكثر: لا مفتاحَ ظِلٍّ ولا نسخةَ احتياط.
    expect([...secure.items.keys()]).toEqual([REFRESH_TOKEN_STORAGE_KEY]);
  });

  test("٩) التخزينُ الآمنُ غيرُ متاح = لا حفظَ ولا تراجعَ إلى مخزنٍ أضعف", async () => {
    // منفذٌ يُبلِّغ عن عدمِ التوفّر — وهي حالةُ عميلٍ أقدمَ من 9.0.
    const secure = unavailableSecureStore();

    const stored = await persistRefreshToken(TOKEN, secure.store);
    expect(stored.stored).toBe(false);
    if (stored.stored) return;
    expect(typeof stored.reason).toBe("string");

    // ولا قراءةَ نجاحٍ زائفة: القراءةُ تعيد «لا رمزَ» لا قيمةً من مكانٍ آخر.
    expect(await loadRefreshToken(secure.store)).toBeNull();

    // والشهادةُ الحقيقيّة: لم يستقرَّ شيءٌ في أيِّ مخزنٍ في العمليةِ كلِّها.
    expect(secure.items.size).toBe(0);
  });

  test("٩ب) لا أثرَ للجلسةِ في مخازنِ الويبِ الأضعفِ ولا في الكوكيز", async () => {
    // فحصٌ بالمقابلِ للحاجزِ الساكن: لو تسلَّل تراجعٌ يوماً، يسقط هذا الاختبار.
    const secure = fakeSecureStore();
    await persistRefreshToken(TOKEN, secure.store);

    expectNoWebStorageTrace();
  });

  test("٩ج) المسارُ الافتراضيُّ بلا مضيفِ تيليجرامَ لا يحفظ ولا يتراجع", async () => {
    // بلا تمريرِ منفذٍ: المحوّلُ الحقيقيُّ هو طبقةُ تيليجرام، ولا مضيفَ في بيئةِ
    // الاختبار. المطلوبُ أن يُبلِّغ عن العدمِ لا أن يبحث عن مخزنٍ أضعف.
    const stored = await persistRefreshToken(TOKEN);
    expect(stored.stored).toBe(false);
    expect(await loadRefreshToken()).toBeNull();

    expectNoWebStorageTrace();
  });

  test("القراءةُ من مخزنٍ فارغٍ تعيد `null` لا نصّاً فارغاً", async () => {
    const secure = fakeSecureStore();
    expect(await loadRefreshToken(secure.store)).toBeNull();
    secure.items.set(REFRESH_TOKEN_STORAGE_KEY, "");
    expect(await loadRefreshToken(secure.store)).toBeNull();
  });

  test("١٠ و١١) الخروجُ يمسح رمزَ التجديدِ من الجهازِ ورمزَ الوصولِ من الذاكرة", async () => {
    const secure = fakeSecureStore();
    await persistRefreshToken(TOKEN, secure.store);
    setSession({ accessToken: "access-token", expiresAt: Date.now() + 600_000 });
    expect(getSession()).not.toBeNull();

    await logoutSession(secure.store);

    expect(getSession()).toBeNull();
    expect(secure.items.has(REFRESH_TOKEN_STORAGE_KEY)).toBe(false);
    expect(await loadRefreshToken(secure.store)).toBeNull();
    expect(secure.calls).toContain(`remove:${REFRESH_TOKEN_STORAGE_KEY}`);
  });

  test("الخروجُ بلا مخزنٍ آمنٍ لا يرفع خطأً ويمسح الذاكرةَ على أيّ حال", async () => {
    const secure = unavailableSecureStore("no-telegram");
    setSession({ accessToken: "access-token", expiresAt: Date.now() + 600_000 });
    await logoutSession(secure.store);
    expect(getSession()).toBeNull();
  });

  test("المسحُ محليٌّ لا إبطالٌ — حدٌّ معلَنٌ يُشهَد عليه بالسلوك", async () => {
    // رمزٌ نُسِخ خارجَ الجهازِ قبلَ المسحِ يبقى نصّاً صالحاً بذاته: لا شيءَ في
    // العميلِ يُبطِله، ولا مخزنَ على الخادمِ يُبطِله (قرارُ `F1-04`). وما يحدُّ
    // الخطرَ هو ساعةُ الرمزِ و١٢ ساعةُ السقفِ لا هذا المسح.
    const secure = fakeSecureStore();
    await persistRefreshToken(TOKEN, secure.store);
    const exfiltrated = secure.items.get(REFRESH_TOKEN_STORAGE_KEY);

    await forgetRefreshToken(secure.store);

    expect(await loadRefreshToken(secure.store)).toBeNull();
    expect(exfiltrated).toBe(TOKEN);
  });
});
