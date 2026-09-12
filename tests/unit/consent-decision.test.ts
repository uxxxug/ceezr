/**
 * الغرض: اختبارُ قرارِ الموافقاتِ النقيِّ (`F2-01`): ترتيبُ الرفضِ، وأنَّ غيابَ
 *   سجلٍّ **ليسَ موافقةً**، وأنَّ إصداراً أقدمَ يُقرأُ «منسوخاً» لا «مُستوفىً»،
 *   وأنَّ سجلَّ الوثائقِ متّسقٌ مع نفسِه.
 * الحالة: اختبار فعلي — دوالُّ نقيّةٌ بلا قاعدةٍ ولا شبكةٍ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عندَ نشرِ إصدارٍ ثانٍ من وثيقةٍ يُضافُ اختبارٌ يُثبِتُ أنَّ
 *   الموافقةَ القديمةَ تبقى في السجلِّ ولا تُحدَّثُ مكانَها (لا مسحَ دليلٍ).
 */

import { describe, expect, it } from "bun:test";
import {
  admitConsentSubmission,
  evaluateOnboardingConsent,
  outstandingConsentKinds,
  type RecordedConsent,
} from "../../packages/domain/consent/consent-decision.ts";
import {
  DECLARED_CONSENT_DOCUMENTS,
  DECLARED_CONSENT_KINDS,
  findDeclaredDocument,
  requiredDocuments,
} from "../../packages/domain/consent/consent-documents.ts";

const TERMS = findDeclaredDocument("terms_of_service");
const PRIVACY = findDeclaredDocument("privacy_policy");
if (TERMS === undefined || PRIVACY === undefined) throw new Error("سجلُّ الوثائقِ ناقصٌ");

function recorded(kind: string, version: string, ms = 1_700_000_000_000): RecordedConsent {
  return { kind, version, acceptedAtMs: ms };
}

describe("سجلُّ الوثائقِ المُعلَنةِ", () => {
  it("١) كلُّ صنفٍ مُعلَنٍ له وثيقةٌ واحدةٌ لا أكثر", () => {
    const kinds = DECLARED_CONSENT_DOCUMENTS.map((d) => d.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect([...kinds].sort()).toEqual([...DECLARED_CONSENT_KINDS].sort());
  });

  it("٢) لكلِّ وثيقةٍ إصدارٌ غيرُ فارغٍ ومفتاحا نصٍّ غيرُ فارغَين", () => {
    for (const document of DECLARED_CONSENT_DOCUMENTS) {
      expect(document.version.length).toBeGreaterThan(0);
      expect(document.titleKey.length).toBeGreaterThan(0);
      expect(document.summaryKey.length).toBeGreaterThan(0);
    }
  });

  it("٣) الوثيقتانِ كلتاهما واجبةٌ للتهيئةِ", () => {
    expect(requiredDocuments().length).toBe(DECLARED_CONSENT_DOCUMENTS.length);
  });
});

describe("قبولُ الإقرارِ — ترتيبُ الرفضِ", () => {
  it("٤) وثيقةٌ مجهولةٌ تُرَدُّ `UNKNOWN_DOCUMENT` ولو قيلَ «نعم» صريحاً", () => {
    const result = admitConsentSubmission({
      kind: "cookie_banner",
      version: "2026-09-12",
      accepted: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("UNKNOWN_DOCUMENT");
  });

  it("٤ب) الشكلُ يُفحَصُ أوّلاً: حقلٌ فارغٌ `MALFORMED` لا `UNKNOWN_DOCUMENT`", () => {
    // وهذا ما تقولُه الشيفرةُ فعلاً، فيُثبَّتُ كما هوَ لا كما تُوقِّعَ ابتداءً:
    // رسالةُ «مجهولةٌ» على حقلٍ فارغٍ تُوهِمُ أنَّ الصنفَ قُرِئَ ولم يُعرَف.
    const result = admitConsentSubmission({ kind: "cookie_banner", version: "", accepted: "yes" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("MALFORMED");
  });

  it("٥) إصدارٌ غيرُ الجاريِ يُرَدُّ ولو كانَ `accepted` صحيحاً", () => {
    const result = admitConsentSubmission({
      kind: TERMS.kind,
      version: "1900-01-01",
      accepted: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("VERSION_NOT_CURRENT");
  });

  it("٦) `accepted` غيرُ `true` رفضٌ — ولا تُخشَّنُ النصوصُ إلى صوابٍ", () => {
    for (const accepted of ["true", 1, "1", "on", {}, [], null, undefined]) {
      const result = admitConsentSubmission({
        kind: TERMS.kind,
        version: TERMS.version,
        accepted,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reason).not.toBe("UNKNOWN_DOCUMENT");
    }
  });

  it("٧) إقرارٌ سليمٌ يُقبَلُ بصنفِه وإصدارِه كما أُعلِنا", () => {
    const result = admitConsentSubmission({
      kind: PRIVACY.kind,
      version: PRIVACY.version,
      accepted: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe(PRIVACY.kind);
      expect(result.value.version).toBe(PRIVACY.version);
    }
  });
});

describe("حالةُ التهيئةِ", () => {
  it("٨) سجلٌّ فارغٌ = كلُّ وثيقةٍ `missing` ولا تهيئةَ مكتملةً", () => {
    const state = evaluateOnboardingConsent([]);
    expect(state.satisfied).toBe(false);
    expect(state.documents.every((d) => d.state === "missing")).toBe(true);
    expect(outstandingConsentKinds([]).length).toBe(DECLARED_CONSENT_DOCUMENTS.length);
  });

  it("٩) إصدارٌ أقدمُ يُقرأُ `superseded` لا `satisfied`", () => {
    const state = evaluateOnboardingConsent([recorded(TERMS.kind, "1900-01-01")]);
    const terms = state.documents.find((d) => d.kind === TERMS.kind);
    expect(terms?.state).toBe("superseded");
    expect(state.satisfied).toBe(false);
  });

  it("١٠) وثيقةٌ واحدةٌ مُستوفاةٌ لا تكفي: الثانيةُ تبقى مطلوبةً", () => {
    const state = evaluateOnboardingConsent([recorded(TERMS.kind, TERMS.version)]);
    expect(state.satisfied).toBe(false);
    expect(outstandingConsentKinds([recorded(TERMS.kind, TERMS.version)])).toEqual([PRIVACY.kind]);
  });

  it("١١) الوثيقتانِ بإصدارِهما الجاريِ = تهيئةٌ مكتملةٌ ولا بقيّةَ", () => {
    const all = [recorded(TERMS.kind, TERMS.version), recorded(PRIVACY.kind, PRIVACY.version)];
    const state = evaluateOnboardingConsent(all);
    expect(state.satisfied).toBe(true);
    expect(outstandingConsentKinds(all)).toEqual([]);
  });

  it("١٢) صفٌّ لصنفٍ غيرِ مُعلَنٍ لا يُستوفي شيئاً ولا يُسقِطُ الحسابَ", () => {
    const state = evaluateOnboardingConsent([recorded("unknown_kind", "2026-09-12")]);
    expect(state.satisfied).toBe(false);
    expect(state.documents.length).toBe(DECLARED_CONSENT_DOCUMENTS.length);
  });
});
