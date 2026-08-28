/**
 * الغرض: مخزنٌ آمنٌ مُصطنَعٌ لاختبارِ سياسةِ تخزينِ الجلسة (`F1-04`) — يُحقِّق منفذَ
 *   `DeviceSecureStore` بذاكرةٍ حقيقيّةٍ في العمليةِ ويسجّل كلَّ نداء.
 * الحالة: أداةُ اختبارٍ — ليست شيفرةَ إنتاجٍ ولا تُستورَد منها.
 * ينتمي إلى: apps/miniapp/src/identity
 * يُتوقع أن يستخدمه لاحقاً: اختباراتُ `session-storage` و`renew`
 *
 * لماذا منفذٌ مُصطنَعٌ لا مضيفُ تيليجرامَ مُصطنَع: اختبارُ السياسةِ يسأل «هل نادت
 * الطبقةُ المخزنَ الصحيحَ وحدَه؟» لا «هل يعمل SDK تيليجرام؟» — والثانيةُ مُختبَرةٌ
 * في موضعِها (`apps/miniapp/src/tg`) خلفَ بابِ الطبقةِ الواحد، ولا يجوز نقضُ عزلِ
 * الطبقةِ (`F1-02` · القسم 9.2) لأجلِ اختبارٍ في طبقةٍ أخرى.
 *
 * الحدُّ المعرفيُّ الصريح: هذا المخزنُ في الذاكرة. المُتحقَّقُ منه هو **مَن يُنادى
 * ومَن لا يُنادى**، لا أنّ `SecureStorage` في تيليجرامَ الحقيقيِّ يُعمّي القيمةَ
 * على جهازٍ حقيقيّ — ذاك يُقاس على الجهازِ، ولم يُقَس بعد.
 */

import type { TgOutcome, TgSecureRead, TgUnavailableReason } from "../tg/index.ts";
import type { DeviceSecureStore } from "./session-storage.ts";

export interface FakeSecureStore {
  readonly store: DeviceSecureStore;
  /** ما استقرَّ فعلاً في المخزن. */
  readonly items: Map<string, string>;
  /** سجلُّ النداءات بالترتيب: `set:key` · `get:key` · `remove:key`. */
  readonly calls: string[];
}

/** مخزنٌ متاحٌ يعمل: يحفظ ويقرأ ويمسح، ويشهد على كلِّ نداءٍ جرى. */
export function fakeSecureStore(): FakeSecureStore {
  const items = new Map<string, string>();
  const calls: string[] = [];
  return {
    items,
    calls,
    store: {
      set(key, value) {
        calls.push(`set:${key}`);
        items.set(key, value);
        return Promise.resolve<TgOutcome<boolean>>({ ok: true, value: true });
      },
      get(key) {
        calls.push(`get:${key}`);
        const value = items.get(key);
        return Promise.resolve<TgOutcome<TgSecureRead>>({
          ok: true,
          value: { value: value === undefined ? null : value, canRestore: false },
        });
      },
      remove(key) {
        calls.push(`remove:${key}`);
        items.delete(key);
        return Promise.resolve<TgOutcome<boolean>>({ ok: true, value: true });
      },
    },
  };
}

/**
 * مخزنٌ غيرُ متاح — حالةُ عميلٍ أقدمَ من 9.0 أو متصفحٍ بلا مضيفِ تيليجرام.
 * يُرجِع سببَ العدمِ ولا يرفع خطأً: غيابُ المخزنِ حالةٌ متوقَّعةٌ لا خلل.
 */
export function unavailableSecureStore(
  reason: TgUnavailableReason = "missing-api",
): FakeSecureStore {
  const items = new Map<string, string>();
  const calls: string[] = [];
  const denied = <T>(): Promise<TgOutcome<T>> => Promise.resolve({ ok: false, reason });
  return {
    items,
    calls,
    store: {
      set(key) {
        calls.push(`set:${key}`);
        return denied<boolean>();
      },
      get(key) {
        calls.push(`get:${key}`);
        return denied<TgSecureRead>();
      },
      remove(key) {
        calls.push(`remove:${key}`);
        return denied<boolean>();
      },
    },
  };
}
