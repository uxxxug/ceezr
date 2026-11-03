/**
 * الغرض: `WR-39` — محوُ ملفّاتِ محادثةِ الحسابِ فورًا بعدَ إتمامِ المحوِ: الحلقةُ
 *   والدفعةُ، وفشلُ المخزنِ لا يُتِمُّ السجلَّ (فلا تدَّعي القاعدةُ حذفًا وهوَ في
 *   المخزنِ)، والتكرارُ آمنٌ (سقوطٌ بينَ الخطوتَينِ ثمَّ التقاطٌ ثانٍ)، والعزلُ
 *   بمعرّفِ صاحبِ الحسابِ، والسقفُ يُقالُ `deferred` لا تعليقًا بلا نهايةٍ،
 *   وفشلُ المحوِ الفوريِّ لا يُفشِلُ المحوَ نفسَهُ.
 * الحالة: اختبار فعلي — محرِّكُ اختباراتٍ بمخزنٍ مُصنَّعٍ (لا قاعدةَ ولا شبكةَ).
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI، وكلُّ تعديلٍ يمسُّ محوَ الوسائطِ.
 */

import { describe, expect, it } from "bun:test";
import type { DataRightsDeps } from "../../packages/application/privacy/data-rights.ts";
import { eraseMyAccount } from "../../packages/application/privacy/data-rights.ts";
import {
  ERASURE_MEDIA_PURGE_BATCH,
  ERASURE_MEDIA_PURGE_MAX_ROUNDS,
  type ErasureChatMediaPurgeDeps,
  type ErasureChatMediaPurgeItem,
  purgeErasureChatMedia,
} from "../../packages/application/privacy/erasure-media-purge.ts";
import type { ErasureOutcome, ErasureReceipt } from "../../packages/domain/privacy/data-rights.ts";
import type { Result } from "../../packages/shared/result/index.ts";

function item(id: string): ErasureChatMediaPurgeItem {
  return { id, objectPath: `orders/o1/${id}` };
}

/** مخزنٌ مُصنَّعٌ يُحصي النداءاتِ ويُفشِلُ الحذفَ عندَ الطلبِ. */
function makeStore(options?: {
  readonly failRemove?: boolean;
  readonly failComplete?: boolean;
  readonly claimSizes?: readonly number[];
}) {
  const state = {
    removed: [] as string[],
    completed: [] as string[],
    claimCalls: 0,
  };
  const sizes = options?.claimSizes ?? [];
  const deps: ErasureChatMediaPurgeDeps = {
    claim: async (userId, limit) => {
      expect(typeof userId).toBe("string");
      expect(limit).toBe(ERASURE_MEDIA_PURGE_BATCH);
      const n = sizes[state.claimCalls] ?? 0;
      state.claimCalls += 1;
      return Array.from({ length: n }, (_, i) => item(`${state.claimCalls}-${i}`));
    },
    remove: async (paths) => {
      if (options?.failRemove === true) return { ok: false as const, error: "STORE_DOWN" };
      state.removed.push(...paths);
      return { ok: true as const, value: undefined };
    },
    complete: async (userId, ids) => {
      if (options?.failComplete === true) throw new Error("complete blew up");
      expect(userId).toBe("u-1");
      state.completed.push(...ids);
    },
  };
  return { deps, state };
}

describe("WR-39 — حلقةُ المحوِ الفوريِّ للوسائطِ", () => {
  it("لا ملفّاتَ: محاولةٌ نظيفةٌ تُقالُ purged بلا نداءِ حذفٍ", async () => {
    const { deps, state } = makeStore({ claimSizes: [0] });
    const report = await purgeErasureChatMedia(deps, "u-1");
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value).toEqual({ purged: 0, deferred: false });
    expect(state.removed).toEqual([]);
    expect(state.completed).toEqual([]);
  });

  it("دفعةٌ واحدةٌ: حذفُ الملفِّ ثمَّ إتمامُ السجلِّ — بالترتيبِ وبالمعرّفِ", async () => {
    const { deps, state } = makeStore({ claimSizes: [3, 0] });
    const report = await purgeErasureChatMedia(deps, "u-1");
    if (!report.ok) throw new Error("no");
    expect(report.value).toEqual({ purged: 3, deferred: false });
    expect(state.removed.length).toBe(3);
    expect(state.completed.length).toBe(3);
  });

  it("فشلُ حذفِ المخزنِ لا يُتِمُّ السجلَّ: الصفوفُ تبقى والنتيجةُ `deferred` — لا تقولَ القاعدةُ «حُذف» وهوَ في المخزنِ", async () => {
    const { deps, state } = makeStore({ claimSizes: [2], failRemove: true });
    const report = await purgeErasureChatMedia(deps, "u-1");
    if (!report.ok) throw new Error("no");
    expect(report.value).toEqual({ purged: 0, deferred: true });
    expect(state.completed).toEqual([]);
  });

  it("سقوطُ الإتمامِ بعدَ حذفِ الملفِّ: `deferred` لا استثناءً — الملفُّ حُذفَ والصفُّ يُلتقَطُ ثانيةً (حذفٌ متكرّرٌ بلا ضررٍ)", async () => {
    const { deps, state } = makeStore({ claimSizes: [2], failComplete: true });
    const report = await purgeErasureChatMedia(deps, "u-1");
    if (!report.ok) throw new Error("no");
    expect(report.value).toEqual({ purged: 0, deferred: true });
    expect(state.removed.length).toBe(2);
  });

  it("أكثرُ من دفعةٍ: جولاتٌ متتاليةٌ حتى فراغِ الطابورِ", async () => {
    const { deps } = makeStore({
      claimSizes: [ERASURE_MEDIA_PURGE_BATCH, ERASURE_MEDIA_PURGE_BATCH, 7, 0],
    });
    const report = await purgeErasureChatMedia(deps, "u-1");
    if (!report.ok) throw new Error("no");
    expect(report.value.purged).toBe(ERASURE_MEDIA_PURGE_BATCH * 2 + 7);
    expect(report.value.deferred).toBe(false);
  });

  it("السقفُ صادقٌ: ما فاضَ عنِ الجولاتِ يُقالُ `deferred` لا تعليقًا بلا نهايةٍ", async () => {
    const always = Array.from(
      { length: ERASURE_MEDIA_PURGE_MAX_ROUNDS + 2 },
      () => ERASURE_MEDIA_PURGE_BATCH,
    );
    const { deps } = makeStore({ claimSizes: always });
    const report = await purgeErasureChatMedia(deps, "u-1");
    if (!report.ok) throw new Error("no");
    expect(report.value.purged).toBe(ERASURE_MEDIA_PURGE_BATCH * ERASURE_MEDIA_PURGE_MAX_ROUNDS);
    expect(report.value.deferred).toBe(true);
  });
});

describe("WR-39 — المحوُ نفسُهُ لا يفشلُ بفشلِ محوِ الوسائطِ", () => {
  /** مستخدمٌ محوٌّ في القاعدةِ — يقرأُهُ المحوُ الفوريُّ من النتيجةِ. */
  const erasedValue = (erasureUserId: string | null, withReceipt = false): ErasureOutcome => ({
    erased: true,
    erasedAt: "2026-11-04T10:00:00Z",
    receipt: withReceipt
      ? ({ erased: {}, anonymized: {}, retained: [] } as unknown as ErasureReceipt)
      : null,
    erasureUserId,
    // المتجرُ لا يجربُ المحوَ — الطبقةُ فوقَهُ تقولُ الحالَ بعدَ المحاولةِ.
    mediaPurge: { status: "unavailable", attachments: 0 },
  });

  function depsWithStore(
    store: {
      eraseMyAccount: () => Promise<
        Result<ErasureOutcome, { readonly reason: "STORE_ERROR" | "MALFORMED_RESULT" }>
      >;
    },
    mediaPurge?: ErasureChatMediaPurgeDeps,
  ) {
    return {
      sessions: SESSION,
      now: () => new Date("2026-11-04T10:00:00Z"),
      store,
      ...(mediaPurge === undefined ? {} : { mediaPurge }),
    } as unknown as DataRightsDeps;
  }

  const SESSION = {
    read: async () => ({ ok: true as const, value: { telegramUserId: "12345" } }),
  } as never;

  it("نجاحُ المحوِ ثمَّ محوُ الوسائطِ يُقالُ في الحالِ (`purged`)", async () => {
    const { deps, state } = makeStore({ claimSizes: [2, 0] });
    const result = await eraseMyAccount(
      depsWithStore(
        {
          eraseMyAccount: () =>
            Promise.resolve({ ok: true as const, value: erasedValue("u-1", true) }),
        },
        deps,
      ),
      { accessToken: "t", confirmation: "حذف" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.erased) throw new Error("no");
    expect(result.value.mediaPurge).toEqual({ status: "purged", attachments: 2 });
    expect(state.completed.length).toBe(2);
  });

  it("فشلُ حذفِ المخزنِ: المحوُّ نجحَ والوسائطُ `deferred` — الفعلُ لا يُنقَضُ والشبكةُ ممدودةٌ", async () => {
    const { deps } = makeStore({ claimSizes: [5], failRemove: true });
    const result = await eraseMyAccount(
      depsWithStore(
        {
          eraseMyAccount: () =>
            Promise.resolve({ ok: true as const, value: erasedValue("u-1", true) }),
        },
        deps,
      ),
      { accessToken: "t", confirmation: "حذف" },
    );
    if (!result.ok || !result.value.erased) throw new Error("no");
    expect(result.value.mediaPurge).toEqual({ status: "deferred", attachments: 0 });
  });

  it("لا منفذَ وسائطَ (`mediaPurge` غائبٌ): المحوُّ كاملٌ والحالُ `unavailable` صريحةً", async () => {
    const result = await eraseMyAccount(
      depsWithStore({
        eraseMyAccount: () => Promise.resolve({ ok: true as const, value: erasedValue("u-1") }),
      }),
      { accessToken: "t", confirmation: "حذف" },
    );
    if (!result.ok || !result.value.erased) throw new Error("no");
    expect(result.value.mediaPurge).toEqual({ status: "unavailable", attachments: 0 });
  });

  it("استثناءٌ في الالتقاطِ لا يُفشِلُ الاستجابةَ بعدَ وقوعِ المحوِ: `deferred`", async () => {
    const result = await eraseMyAccount(
      depsWithStore(
        {
          eraseMyAccount: () =>
            Promise.resolve({ ok: true as const, value: erasedValue("u-1", true) }),
        },
        {
          claim: () => Promise.reject(new Error("db gone")),
          remove: () => Promise.resolve({ ok: true as const, value: undefined }),
          complete: () => Promise.resolve(),
        },
      ),
      { accessToken: "t", confirmation: "حذف" },
    );
    if (!result.ok || !result.value.erased) throw new Error("no");
    expect(result.value.mediaPurge).toEqual({ status: "deferred", attachments: 0 });
  });

  it("لا معرّفَ داخليًّا في النتيجةِ (`erasureUserId: null`): لا محاولةَ والحالُ `unavailable`", async () => {
    const result = await eraseMyAccount(
      depsWithStore(
        { eraseMyAccount: () => Promise.resolve({ ok: true as const, value: erasedValue(null) }) },
        makeStore({ claimSizes: [1, 0] }).deps,
      ),
      { accessToken: "t", confirmation: "حذف" },
    );
    if (!result.ok || !result.value.erased) throw new Error("no");
    expect(result.value.mediaPurge).toEqual({ status: "unavailable", attachments: 0 });
  });

  it("رفضُ المحوِ (نشاطٌ جارٍ): لا محوَ وسائطَ أصلًا", async () => {
    let purgedCalled = false;
    const result = await eraseMyAccount(
      depsWithStore(
        {
          eraseMyAccount: () =>
            Promise.resolve({
              ok: true as const,
              value: {
                erased: false as const,
                refusal: "ACTIVE_ORDER",
                activeOrders: 1,
                walletBalanceMinor: 0,
              },
            }),
        },
        {
          claim: async () => {
            purgedCalled = true;
            return [];
          },
          remove: async () => ({ ok: true as const, value: undefined }),
          complete: async () => {},
        },
      ),
      { accessToken: "t", confirmation: "حذف" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.erased).toBe(false);
    expect(purgedCalled).toBe(false);
  });
});
