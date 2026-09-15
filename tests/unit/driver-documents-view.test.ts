/**
 * الغرض: قياسُ منطقِ العرضِ الخالصِ لسطحِ وثائقِ السائقِ — النغمةُ وسطورُ الحجبِ
 *   والرفضُ اللطيفُ واليومُ المدنيُّ (البند `F3-01` · `SD-02`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ولماذا يُقاسُ العرضُ ههنا لا في تكاملٍ: هذه دوالُّ خالصةٌ، وأخطاؤها **صامتةٌ
 * بالكاملِ** — نغمةٌ خاطئةٌ تُري السائقَ «مقبولةٌ» عن وثيقةٍ منتهيةٍ، ولا سطرَ
 * سجلٍّ يشكو ولا ردَّ خادمٍ يختلفُ.
 */

import { describe, expect, it } from "bun:test";
import type {
  ApiDriverDocumentRow,
  DriverDocumentsResponse,
} from "../../apps/miniapp/src/surfaces/driver/documents/documents-contract.ts";
import {
  canSubmitForReview,
  documentsErrorKey,
  isRetryableDocumentsError,
  rejectExpiryLocally,
  rejectFileLocally,
  toBlockLines,
  toBoardSummary,
  toDocumentCard,
  todayPlainDay,
} from "../../apps/miniapp/src/surfaces/driver/documents/documents-view.ts";

function row(overrides: Partial<ApiDriverDocumentRow> = {}): ApiDriverDocumentRow {
  return {
    doc_type: "driving_license",
    status: null,
    submitted: false,
    expires_at: null,
    days_left: null,
    expires_soon: false,
    review_note: null,
    submitted_at: null,
    reviewed_at: null,
    ...overrides,
  };
}

describe("نغمةُ البطاقةِ", () => {
  it("وثيقةٌ لم تُرسَلْ نغمتُها غيابٌ ولها زرُّ رفعٍ ولا إحلالَ", () => {
    const card = toDocumentCard(row());
    expect(card.tone).toBe("missing");
    expect(card.statusKey).toBe("driver.documents.status.missing");
    expect(card.canUpload).toBe(true);
    expect(card.replaces).toBe(false);
  });

  it("مقبولةٌ غيرُ مقتربةٍ من الانتهاءِ: **لا زرَّ رفعٍ** كي لا يُبتلَعَ قبولٌ قائمٌ", () => {
    const card = toDocumentCard(row({ status: "accepted", submitted: true }));
    expect(card.tone).toBe("accepted");
    expect(card.canUpload).toBe(false);
  });

  it("مقبولةٌ تقتربُ من الانتهاءِ نغمتُها «تنتهي» ويُفتَحُ الرفعُ — الحجبُ ساعةٌ لا رايةٌ", () => {
    const card = toDocumentCard(
      row({ status: "accepted", submitted: true, expires_soon: true, days_left: 9 }),
    );
    expect(card.tone).toBe("expiring");
    expect(card.canUpload).toBe(true);
    expect(card.daysLeft).toBe(9);
  });

  it("مرفوضةٌ وناقصةٌ نغمتُهما واحدةٌ: كلتاهما تطلبُ ورقةً جديدةً", () => {
    expect(toDocumentCard(row({ status: "rejected", submitted: true })).tone).toBe("refused");
    expect(toDocumentCard(row({ status: "incomplete", submitted: true })).tone).toBe("refused");
  });

  it("قيدَ المراجعةِ ومُستلَمةٌ نغمتُهما انتظارٌ", () => {
    expect(toDocumentCard(row({ status: "received", submitted: true })).tone).toBe("waiting");
    expect(toDocumentCard(row({ status: "under_review", submitted: true })).tone).toBe("waiting");
  });

  it("حالةٌ منشورةٌ بلا إرسالٍ تُقرأُ غياباً — الصفُّ لا يُصدَّقُ على الرايةِ وحدَها", () => {
    expect(toDocumentCard(row({ status: "accepted", submitted: false })).tone).toBe("missing");
  });
});

describe("سطورُ الحجبِ", () => {
  it("كلُّ سطرٍ يسمّي وثيقتَه ويحملُ مُعرِّفاً لا يُخلَطُ", () => {
    const lines = toBlockLines(
      [
        { code: "MISSING", doc_type: "insurance" },
        { code: "EXPIRED", doc_type: "medical_exam" },
      ],
      0,
    );
    expect(lines.map((line) => line.id)).toEqual(["MISSING:insurance", "EXPIRED:medical_exam"]);
    expect(lines[0]?.labelKey).toBe("driver.documents.type.insurance");
    expect(lines[1]?.messageKey).toBe("driver.documents.block.EXPIRED");
  });

  it("نوعٌ لا تعرفُه هذه النسخةُ يُقالُ عامّاً ولا يُسكَتُ عنه", () => {
    // **التحويلُ القسريُّ ههنا هوَ المقيسُ نفسُه**: الخادمُ قد يُضيفَ نوعاً غداً
    // لا تعرفُه هذه النسخةُ من الواجهةِ، والنوعُ الساكنُ يمنعُ كتابةَ ذلكَ إلّا
    // بتحويلٍ — فيُكتَبُ صريحاً لا مُخفىً.
    const unknownType = "future_type" as ApiDriverDocumentRow["doc_type"];
    const lines = toBlockLines([{ code: "MISSING", doc_type: unknownType }], 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.messageKey).toBe("driver.documents.block.UNKNOWN");
    expect(lines[0]?.labelKey).toBeNull();
  });

  it("سببٌ غيرُ مقروءٍ من الخادمِ يُعدُّ سطراً — لا حجبَ بلا سطرٍ", () => {
    const lines = toBlockLines([], 2);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.id).toBe("UNREADABLE:2");
  });

  it("لا حجبَ ولا غيرَ مقروءٍ ⇒ لا سطرَ", () => {
    expect(toBlockLines([], 0)).toEqual([]);
  });
});

describe("زرُّ الإرسالِ للمراجعةِ", () => {
  it("يُعرَضُ حينَ توجدُ وثيقةٌ مُستلَمةٌ لم تُراجَعْ بعدُ", () => {
    expect(canSubmitForReview([row({ status: "received", submitted: true })])).toBe(true);
  });

  it("لا يُعرَضُ حينَ لا شيءَ مرفوعٌ — زرٌّ يُردُّ رفضاً دائماً يُقرأُ عطباً", () => {
    expect(canSubmitForReview([row(), row({ doc_type: "insurance" })])).toBe(false);
  });

  it("لا يُعرَضُ حينَ كلُّ ما رُفِعَ قيدَ المراجعةِ أو مقبولٌ", () => {
    expect(
      canSubmitForReview([
        row({ status: "under_review", submitted: true }),
        row({ doc_type: "insurance", status: "accepted", submitted: true }),
      ]),
    ).toBe(false);
  });
});

describe("الرفضُ اللطيفُ للمِلفِّ — حدُّه من الخادمِ لا من العميلِ", () => {
  it("مِلفٌّ فارغٌ يُرَدُّ بحجمٍ غيرِ صالحٍ", () => {
    expect(
      rejectFileLocally({
        sizeBytes: 0,
        contentType: "image/png",
        maxBytes: 100,
        allowedContentTypes: ["image/png"],
      })?.key,
    ).toBe("driver.documents.error.SIZE_INVALID");
  });

  it("مِلفٌّ فوقَ الحدِّ يُرَدُّ بالحدِّ نفسِه كي يُعرَضَ رقماً", () => {
    const rejection = rejectFileLocally({
      sizeBytes: 200,
      contentType: "image/png",
      maxBytes: 100,
      allowedContentTypes: ["image/png"],
    });
    expect(rejection?.key).toBe("driver.documents.error.FILE_TOO_LARGE");
    expect(rejection?.maxBytes).toBe(100);
  });

  it("نوعُ محتوىً غيرُ مسموحٍ يُرَدُّ قبلَ إنفاقِ بياناتِ السائقِ", () => {
    expect(
      rejectFileLocally({
        sizeBytes: 10,
        contentType: "image/gif",
        maxBytes: 100,
        allowedContentTypes: ["image/png"],
      })?.key,
    ).toBe("driver.documents.error.CONTENT_TYPE_NOT_ALLOWED");
  });

  it("**لا حدَّ يُخترَعُ في العميلِ**: عندَ غيابِ السياسةِ لا يُمنَعُ إلّا الفراغُ", () => {
    expect(
      rejectFileLocally({
        sizeBytes: 9_000_000,
        contentType: "application/zip",
        maxBytes: null,
        allowedContentTypes: null,
      }),
    ).toBeNull();
  });
});

describe("الرفضُ اللطيفُ للانتهاءِ — يومٌ مدنيٌّ لا طابعٌ زمنيٌّ", () => {
  it("شكلٌ غيرُ صالحٍ يُرَدُّ", () => {
    expect(rejectExpiryLocally({ value: "15/09/2026", todayPlainDay: "2026-09-15" })).toBe(
      "driver.documents.error.EXPIRY_INVALID",
    );
  });

  it("**يومُ اليومِ نفسُه ماضٍ**: وثيقةٌ تنتهي اليومَ لا تُقبَلُ ورقةً جديدةً", () => {
    expect(rejectExpiryLocally({ value: "2026-09-15", todayPlainDay: "2026-09-15" })).toBe(
      "driver.documents.error.EXPIRY_IN_PAST",
    );
  });

  it("الغدُ يُقبَلُ — ولا تُسقِطُه منطقةٌ زمنيّةٌ إذ لا طابعَ في المقارنةِ", () => {
    expect(rejectExpiryLocally({ value: "2026-09-16", todayPlainDay: "2026-09-15" })).toBeNull();
  });

  it("تاريخٌ أبعدُ من عشرينَ سنةً يُرَدُّ — طابعُ لوحةِ مفاتيحَ لا وثيقةٌ", () => {
    expect(rejectExpiryLocally({ value: "2226-09-16", todayPlainDay: "2026-09-15" })).toBe(
      "driver.documents.error.EXPIRY_TOO_FAR",
    );
  });

  it("يومٌ لا وجودَ له في التقويمِ يُرَدُّ ولا يُنزلَقُ إلى الشهرِ التالي", () => {
    expect(rejectExpiryLocally({ value: "2027-02-31", todayPlainDay: "2026-09-15" })).toBe(
      "driver.documents.error.EXPIRY_INVALID",
    );
  });
});

describe("اليومُ المدنيُّ بساعةِ الجهازِ", () => {
  it("يُكتَبُ بالأرقامِ المُبطَّنةِ لا بشهرٍ من صفرٍ", () => {
    expect(todayPlainDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("مفتاحُ الخطأِ", () => {
  it("رمزٌ معروفٌ يُعرَضُ بنصِّه", () => {
    expect(documentsErrorKey("FILE_TOO_LARGE")).toBe("driver.documents.error.FILE_TOO_LARGE");
  });

  it("رمزٌ من خادمٍ أحدثَ يُعرَضُ نصّاً عامّاً لا مفتاحاً خامّاً", () => {
    expect(documentsErrorKey("SOMETHING_NEW")).toBe("driver.documents.error.UNKNOWN");
  });

  it("العَطبُ العارضُ وحدَه يُعادُ فيه المحاولةُ — والرفضُ لا يُعادُ", () => {
    expect(isRetryableDocumentsError("UPLOAD_FAILED")).toBe(true);
    expect(isRetryableDocumentsError("DOCUMENT_STORE_NOT_AVAILABLE")).toBe(true);
    expect(isRetryableDocumentsError("FILE_TOO_LARGE")).toBe(false);
    expect(isRetryableDocumentsError("DOCUMENTS_INCOMPLETE")).toBe(false);
  });
});

describe("ملخَّصُ اللوحِ", () => {
  function response(overrides: Partial<DriverDocumentsResponse> = {}): DriverDocumentsResponse {
    return {
      ok: true,
      verification_status: "pending",
      warning_days: 30,
      documents: [],
      block_reasons: [],
      unreadable_block_reasons: 0,
      is_blocked: false,
      ...overrides,
    };
  }

  it("المحجوبُ يقرأُ عنوانَ الحجبِ أوّلاً", () => {
    const summary = toBoardSummary(
      response({ is_blocked: true, block_reasons: [{ code: "MISSING", doc_type: "insurance" }] }),
    );
    expect(summary.headlineKey).toBe("driver.documents.headline.blocked");
    expect(summary.blockLines).toHaveLength(1);
  });

  it("غيرُ المحجوبِ الذي تقتربُ وثيقتُه يقرأُ تحذيراً لا تطميناً", () => {
    const summary = toBoardSummary(
      response({
        documents: [row({ status: "accepted", submitted: true, expires_soon: true, days_left: 3 })],
      }),
    );
    expect(summary.headlineKey).toBe("driver.documents.headline.expiring");
  });

  it("الخالي من الحجبِ والاقترابِ يقرأُ تطميناً", () => {
    const summary = toBoardSummary(
      response({ documents: [row({ status: "accepted", submitted: true })] }),
    );
    expect(summary.headlineKey).toBe("driver.documents.headline.clear");
    expect(summary.canSubmit).toBe(false);
  });
});
