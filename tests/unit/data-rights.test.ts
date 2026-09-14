/**
 * الغرض: قياسُ طبقتَي التطبيقِ والبنيةِ التحتيّةِ لحقَّي البيانةِ (`F2-11`) —
 *   شرطُ التأكيدِ، وقراءةُ الحمولةِ **بلا افتراضٍ**، ونموذجُ عرضِ الإيصالِ.
 * الحالة: منفَّذٌ فعليّاً — البند `F2-11`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * ## ولماذا معظمُ ما ههنا **حالاتٌ سلبيّةٌ**
 *
 * المسارُ السعيدُ في هذا البندِ مقيسٌ على قاعدةٍ حقيقيّةٍ (`tests/integration`).
 * والذي لا تقيسُه القاعدةُ هوَ **ما تفعلُه الشيفرةُ حينَ تصلُها حمولةٌ لا
 * تُفهَمُ**: إيصالٌ ناقصٌ يُقرأُ «مُحيَ كلُّ شيءٍ» خطرٌ لا يُرى إلّا ههنا.
 */

import { describe, expect, it } from "bun:test";
import {
  accountErrorKey,
  erasureRefusalKey,
  exportRefusalKey,
  retentionBasisKey,
  toReceiptView,
} from "../../apps/miniapp/src/surfaces/rider/account/account-view.ts";
import {
  ERASURE_CONFIRMATION_WORDS,
  eraseMyAccount,
  exportMyData,
  isErasureConfirmed,
} from "../../packages/application/privacy/data-rights.ts";
import type { DataRightsStore } from "../../packages/application/privacy/ports.ts";
import { dataExportFileName } from "../../packages/domain/privacy/data-rights.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { PostgresDataRightsStore } from "../../packages/infrastructure/privacy/data-rights-store.ts";
import { ok } from "../../packages/shared/result/index.ts";

const SESSION = {
  read: () => ok({ telegramUserId: "12345" }),
} as never;

function deps(store: DataRightsStore) {
  return { sessions: SESSION, store, now: () => new Date("2026-09-14T12:00:00Z") };
}

const NEVER_STORE: DataRightsStore = {
  exportMyData: () => {
    throw new Error("لا يُنادى المخزنُ في هذا الاختبارِ");
  },
  eraseMyAccount: () => {
    throw new Error("لا يُنادى المخزنُ في هذا الاختبارِ");
  },
};

// ---------------------------------------------------------------------------
// شرطُ التأكيدِ — الحاجزُ في الطبقةِ التي لا تُتجاوَزُ
// ---------------------------------------------------------------------------

describe("كلمةُ التأكيدِ", () => {
  it("تقبلُ الكلماتِ الثلاثَ ولا غيرَها", () => {
    for (const word of ERASURE_CONFIRMATION_WORDS) expect(isErasureConfirmed(word)).toBe(true);
    expect(isErasureConfirmed("yes")).toBe(false);
    expect(isErasureConfirmed("delete")).toBe(false);
    expect(isErasureConfirmed("احذف")).toBe(false);
    expect(isErasureConfirmed(undefined)).toBe(false);
    expect(isErasureConfirmed("")).toBe(false);
  });

  it("تقصُّ الفراغَ وحدَه — لا تخشينَ ولا تطبيعَ", () => {
    expect(isErasureConfirmed("  حذف  ")).toBe(true);
    expect(isErasureConfirmed("ح ذف")).toBe(false);
  });

  it("**لا يُمَسُّ المخزنُ إطلاقاً** حينَ يغيبُ التأكيدُ", async () => {
    const result = await eraseMyAccount(deps(NEVER_STORE), {
      accessToken: "t",
      confirmation: "بالتأكيد",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("CONFIRMATION_REQUIRED");
  });

  it("جلسةٌ غائبةٌ تُرَدُّ قبلَ النظرِ في التأكيدِ", async () => {
    const result = await eraseMyAccount(deps(NEVER_STORE), {
      accessToken: undefined,
      confirmation: "حذف",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SESSION_REQUIRED");
  });
});

// ---------------------------------------------------------------------------
// المحوّلُ — حمولةٌ لا تُفهَمُ تُعلَنُ عطباً
// ---------------------------------------------------------------------------

function sqlReturning(payload: unknown): Sql {
  return (() => Promise.resolve([{ result: payload }])) as unknown as Sql;
}

function sqlThrowing(): Sql {
  return (() => Promise.reject(new Error("انقطعَ الاتّصالُ"))) as unknown as Sql;
}

const GOOD_RECEIPT = {
  erased: { savedPlaces: 3 },
  anonymized: { profile: 1 },
  retained: [{ section: "consents", rows: 1, basis: "CONSENT_IS_COMPLIANCE_EVIDENCE" }],
};

describe("محوّلُ الحذفِ يقرأُ ولا يفترضُ", () => {
  it("يقرأُ الإيصالَ السليمَ", async () => {
    const store = new PostgresDataRightsStore(
      sqlReturning({
        ok: true,
        reason: "ERASED",
        erased_at: "2026-09-14T12:00:00Z",
        receipt: GOOD_RECEIPT,
      }),
    );
    const result = await store.eraseMyAccount({ telegramUserId: "12345" });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.erased) {
      expect(result.value.receipt?.erased.savedPlaces).toBe(3);
      expect(result.value.receipt?.retained[0]?.basis).toBe("CONSENT_IS_COMPLIANCE_EVIDENCE");
    }
  });

  it("**أساسُ إبقاءٍ خارجَ المجالِ المغلقِ يُسقِطُ القراءةَ** ولا يُعرَضُ خاماً", async () => {
    const store = new PostgresDataRightsStore(
      sqlReturning({
        ok: true,
        erased_at: "2026-09-14T12:00:00Z",
        receipt: {
          ...GOOD_RECEIPT,
          retained: [{ section: "consents", rows: 1, basis: "BECAUSE_WE_FELT_LIKE_IT" }],
        },
      }),
    );
    const result = await store.eraseMyAccount({ telegramUserId: "12345" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("MALFORMED_RESULT");
  });

  it("إيصالٌ بلا سطرِ إبقاءٍ واحدٍ عطبٌ — سجلُّ التدقيقِ يبقى دائماً", async () => {
    const store = new PostgresDataRightsStore(
      sqlReturning({
        ok: true,
        erased_at: "2026-09-14T12:00:00Z",
        receipt: { ...GOOD_RECEIPT, retained: [] },
      }),
    );
    expect((await store.eraseMyAccount({ telegramUserId: "12345" })).ok).toBe(false);
  });

  it("عددٌ سالبٌ أو كسريٌّ عطبٌ ولا يُقرَّبُ", async () => {
    const store = new PostgresDataRightsStore(
      sqlReturning({
        ok: true,
        erased_at: "2026-09-14T12:00:00Z",
        receipt: { ...GOOD_RECEIPT, erased: { savedPlaces: -1 } },
      }),
    );
    expect((await store.eraseMyAccount({ telegramUserId: "12345" })).ok).toBe(false);
  });

  it("`ALREADY_ERASED` يُعادُ نجاحاً **بلا إيصالٍ مختلَقٍ**", async () => {
    const store = new PostgresDataRightsStore(
      sqlReturning({ ok: true, reason: "ALREADY_ERASED", erased_at: "2026-09-01T00:00:00Z" }),
    );
    const result = await store.eraseMyAccount({ telegramUserId: "12345" });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.erased) expect(result.value.receipt).toBeNull();
  });

  it("`ACTIVE_ORDER` يحملُ العددَ مقروءاً لا مفترَضاً صفراً", async () => {
    const store = new PostgresDataRightsStore(
      sqlReturning({ ok: false, reason: "ACTIVE_ORDER", active_orders: 2 }),
    );
    const result = await store.eraseMyAccount({ telegramUserId: "12345" });
    expect(result.ok).toBe(true);
    if (result.ok && !result.value.erased) {
      expect(result.value.refusal).toBe("ACTIVE_ORDER");
      expect(result.value.activeOrders).toBe(2);
    }
  });

  it("`ACTIVE_ORDER` بلا عددٍ عطبٌ — شاشةٌ تقولُ «لا شيءَ يمنعُكَ» ثمَّ ترفضُ", async () => {
    const store = new PostgresDataRightsStore(sqlReturning({ ok: false, reason: "ACTIVE_ORDER" }));
    expect((await store.eraseMyAccount({ telegramUserId: "12345" })).ok).toBe(false);
  });

  it("رمزُ رفضٍ لا يعرفُه المجالُ عطبٌ", async () => {
    const store = new PostgresDataRightsStore(sqlReturning({ ok: false, reason: "MEH" }));
    expect((await store.eraseMyAccount({ telegramUserId: "12345" })).ok).toBe(false);
  });

  it("معرّفٌ غيرُ رقميٍّ **لا يصلُ القاعدةَ أصلاً**", async () => {
    const store = new PostgresDataRightsStore(sqlThrowing());
    const result = await store.eraseMyAccount({ telegramUserId: "12'; drop table users; --" });
    expect(result.ok).toBe(true);
    if (result.ok && !result.value.erased) expect(result.value.refusal).toBe("INVALID_ACTOR");
  });

  it("انقطاعُ القاعدةِ `STORE_ERROR` لا `MALFORMED_RESULT`", async () => {
    const store = new PostgresDataRightsStore(sqlThrowing());
    const result = await store.eraseMyAccount({ telegramUserId: "12345" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("STORE_ERROR");
  });
});

describe("محوّلُ التنزيلِ", () => {
  it("يقرأُ الحزمةَ السليمةَ", async () => {
    const store = new PostgresDataRightsStore(
      sqlReturning({
        ok: true,
        generated_at: "2026-09-14T12:00:00Z",
        subject: "rider",
        sections: { savedPlaces: [] },
      }),
    );
    const result = await store.exportMyData({ telegramUserId: "12345" });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.exported) expect(result.value.bundle.subject).toBe("rider");
  });

  it("حزمةٌ بلا أقسامٍ عطبٌ — ملفٌّ فارغٌ يُقرأُ «لا شيءَ لدينا عنكَ»", async () => {
    const store = new PostgresDataRightsStore(
      sqlReturning({ ok: true, generated_at: "2026-09-14T12:00:00Z", subject: "rider" }),
    );
    expect((await store.exportMyData({ telegramUserId: "12345" })).ok).toBe(false);
  });

  it("يُمرِّرُ الرفضَ المعروفَ حالةً لا عطباً", async () => {
    const store = new PostgresDataRightsStore(
      sqlReturning({ ok: false, reason: "ACCOUNT_ERASED" }),
    );
    const result = await store.exportMyData({ telegramUserId: "12345" });
    expect(result.ok).toBe(true);
    if (result.ok && !result.value.exported) expect(result.value.refusal).toBe("ACCOUNT_ERASED");
  });

  it("عطبُ المخزنِ يُترجَمُ رمزاً واحداً في طبقةِ التطبيقِ", async () => {
    const failing: DataRightsStore = {
      exportMyData: () => Promise.resolve({ ok: false, error: { reason: "STORE_ERROR" } } as never),
      eraseMyAccount: NEVER_STORE.eraseMyAccount,
    };
    const result = await exportMyData(deps(failing), { accessToken: "t" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("PRIVACY_STORE_NOT_AVAILABLE");
  });
});

// ---------------------------------------------------------------------------
// اسمُ الملفِّ ونموذجُ العرضِ
// ---------------------------------------------------------------------------

describe("اسمُ ملفِّ التنزيلِ", () => {
  it("**بلا اسمٍ ولا رقمٍ** — يُرى في مجلَّدِ التنزيلاتِ وفي الإشعارِ", () => {
    const name = dataExportFileName("2026-09-14T12:00:00Z");
    expect(name).toBe("wasla-move-my-data-20260914.json");
    expect(name).not.toContain("12345");
  });
});

describe("نموذجُ عرضِ الإيصالِ", () => {
  it("يرتّبُ الأقسامَ ويجمعُ ما مُحيَ وجُهِّلَ", () => {
    const view = toReceiptView({
      erased: { tripTrackingTokens: 1, savedPlaces: 3 },
      anonymized: { profile: 1, orders: 4 },
      retained: [
        { section: "ratings", rows: 2, basis: "RATING_IS_TESTIMONY_FOR_THE_OTHER_PARTY" },
        { section: "auditTrail", rows: 1, basis: "AUDIT_TRAIL_PROVES_THIS_ERASURE" },
      ],
    });
    expect(view.erased.map((line) => line.section)).toEqual(["savedPlaces", "tripTrackingTokens"]);
    expect(view.retained.map((line) => line.section)).toEqual(["auditTrail", "ratings"]);
    expect(view.totalRemoved).toBe(9);
    expect(view.erased.every((line) => line.basis === null)).toBe(true);
  });
});

describe("المفاتيحُ — رمزٌ مجهولٌ يُقرأُ نصّاً عامّاً لا خاماً", () => {
  it("أساسٌ معروفٌ ومجهولٌ", () => {
    expect(retentionBasisKey("CONSENT_IS_COMPLIANCE_EVIDENCE")).toBe(
      "rider.account.basis.CONSENT_IS_COMPLIANCE_EVIDENCE",
    );
    expect(retentionBasisKey("SOMETHING_NEW")).toBe("rider.account.basis.UNKNOWN");
  });

  it("رفضُ حذفٍ ورفضُ تنزيلٍ وخطأُ حدٍّ", () => {
    expect(erasureRefusalKey("ACTIVE_ORDER")).toBe("rider.account.erasure.refusal.ACTIVE_ORDER");
    expect(erasureRefusalKey("NOPE")).toBe("rider.account.erasure.refusal.UNKNOWN");
    expect(exportRefusalKey("ACCOUNT_ERASED")).toBe("rider.account.export.refusal.ACCOUNT_ERASED");
    expect(exportRefusalKey("NOPE")).toBe("rider.account.export.refusal.UNKNOWN");
    expect(accountErrorKey("CONFIRMATION_REQUIRED")).toBe(
      "rider.account.error.CONFIRMATION_REQUIRED",
    );
    expect(accountErrorKey("BOOM")).toBe("rider.account.error.UNKNOWN");
  });
});
