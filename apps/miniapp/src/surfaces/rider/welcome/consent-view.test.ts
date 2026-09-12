/**
 * الغرض: اختبارُ نموذجِ عرضِ شاشةِ الترحيبِ (`F2-01`): دمجُ الوثائقِ بحالاتِها،
 *   وأنَّ وثيقةً بلا حالةٍ **تبقى مطلوبةً** لا تُطرَحُ، وترجمةُ رموزِ الأخطاءِ،
 *   وأنَّ زرَّ «أعِد المحاولةَ» لا يُعرَضُ على خطأٍ لا تُصلِحُه المحاولةُ.
 * الحالة: اختبار فعلي — دوالُّ نقيّةٌ بلا DOM ولا شبكةٍ.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/welcome
 * يُتوقع أن يستخدمه لاحقاً: CI
 */

import { describe, expect, it } from "bun:test";
import {
  type ConsentApiStatus,
  consentErrorKey,
  consentRows,
  isRetryable,
  outstandingRows,
} from "./consent-view.ts";

function status(
  documents: ConsentApiStatus["documents"],
  onboarding: ConsentApiStatus["onboarding"],
): ConsentApiStatus {
  return { ok: true, documents, onboarding };
}

const TERMS = {
  kind: "terms_of_service",
  version: "2026-09-12",
  titleKey: "consent.terms_of_service.title",
  summaryKey: "consent.terms_of_service.summary",
  requiredForOnboarding: true,
} as const;

const PRIVACY = {
  kind: "privacy_policy",
  version: "2026-09-12",
  titleKey: "consent.privacy_policy.title",
  summaryKey: "consent.privacy_policy.summary",
  requiredForOnboarding: true,
} as const;

describe("دمجُ صفوفِ الموافقاتِ", () => {
  it("١) يبني صفّاً لكلِّ وثيقةٍ أعلنَها الخادمُ بحالتِها ونصِّ حالتِها", () => {
    const rows = consentRows(
      status([TERMS, PRIVACY], {
        satisfied: false,
        documents: [
          { kind: TERMS.kind, currentVersion: TERMS.version, state: "satisfied" },
          { kind: PRIVACY.kind, currentVersion: PRIVACY.version, state: "missing" },
        ],
      }),
    );
    expect(rows.map((r) => r.state)).toEqual(["satisfied", "missing"]);
    expect(rows[0]?.statusKey).toBe("welcome.consent_recorded");
    expect(rows[1]?.statusKey).toBe("welcome.consent_pending");
  });

  it("٢) وثيقةٌ بلا حالةٍ مقابلةٍ تُعَدُّ ناقصةً ولا تُطرَحُ من القائمةِ", () => {
    const rows = consentRows(status([TERMS, PRIVACY], { satisfied: false, documents: [] }));
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.state === "missing")).toBe(true);
    expect(outstandingRows(rows).length).toBe(2);
  });

  it("٣) حالةٌ لصنفٍ لم يُعلَنْ في `documents` تُهمَلُ ولا تُضيفُ صفّاً", () => {
    const rows = consentRows(
      status([TERMS], {
        satisfied: false,
        documents: [
          { kind: TERMS.kind, currentVersion: TERMS.version, state: "missing" },
          { kind: "marketing_emails", currentVersion: "2026-01-01", state: "missing" },
        ],
      }),
    );
    expect(rows.map((r) => r.kind)).toEqual([TERMS.kind]);
  });

  it("٤) `superseded` تبقى مطلوبةً ونصُّها يقولُ إنَّ الوثيقةَ تغيَّرَت", () => {
    const rows = consentRows(
      status([TERMS], {
        satisfied: false,
        documents: [
          {
            kind: TERMS.kind,
            currentVersion: TERMS.version,
            state: "superseded",
            recordedVersion: "1900-01-01",
          },
        ],
      }),
    );
    expect(rows[0]?.statusKey).toBe("welcome.consent_superseded");
    expect(outstandingRows(rows).length).toBe(1);
  });

  it("٥) وثيقةٌ غيرُ واجبةٍ لا تُعَدُّ في المتبقّي ولو كانت ناقصةً", () => {
    const optional = { ...TERMS, requiredForOnboarding: false };
    const rows = consentRows(status([optional], { satisfied: true, documents: [] }));
    expect(rows.length).toBe(1);
    expect(outstandingRows(rows).length).toBe(0);
  });
});

describe("ترجمةُ الأخطاءِ وقابليّةُ إعادةِ المحاولةِ", () => {
  it("٦) لكلِّ رمزٍ مُعلَنٍ مفتاحُ نصٍّ من عائلةِ `welcome.error`", () => {
    const codes = [
      "SESSION_REQUIRED",
      "SESSION_INVALID",
      "SESSION_EXPIRED",
      "SESSION_NOT_AVAILABLE",
      "CONSENT_STORE_NOT_AVAILABLE",
      "UNKNOWN_DOCUMENT",
      "VERSION_NOT_CURRENT",
      "NOT_ACCEPTED",
      "MALFORMED",
      "ACCOUNT_NOT_FOUND",
    ];
    for (const code of codes) {
      expect(consentErrorKey(code)).toStartWith("welcome.error.");
    }
  });

  it("٧) رمزٌ مجهولٌ لا يُخفى: يرتدُّ إلى رسالةِ رفضٍ ظاهرةٍ", () => {
    expect(consentErrorKey("SOMETHING_NEW")).toBe("welcome.error.rejected");
    expect(consentErrorKey("")).toBe("welcome.error.rejected");
  });

  it("٨) لا زرَّ إعادةِ محاولةٍ على ما لا تُصلِحُه المحاولةُ", () => {
    for (const code of [
      "SESSION_REQUIRED",
      "SESSION_INVALID",
      "SESSION_EXPIRED",
      "ACCOUNT_NOT_FOUND",
      "VERSION_NOT_CURRENT",
      "UNKNOWN_DOCUMENT",
    ]) {
      expect(isRetryable(code)).toBe(false);
    }
  });

  it("٩) عطلُ سجلٍّ أو رفضٌ عارضٌ قابلٌ لإعادةِ المحاولةِ", () => {
    expect(isRetryable("CONSENT_STORE_NOT_AVAILABLE")).toBe(true);
    expect(isRetryable("NOT_ACCEPTED")).toBe(true);
    expect(isRetryable("UNKNOWN")).toBe(true);
  });
});
