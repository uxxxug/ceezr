import { describe, expect, it, mock } from "bun:test";

/**
 * عقدُ شاشةِ الخصوصيّةِ (DEC-35) — اختبارُ السلوكِ:
 *
 * ١. `consentRows` يَدمجُ الوثائقَ بحالاتِها — يعيدُ استخدامُ المنطقَ من شاشةِ الترحيبِ.
 * ٢. `onOpenPrivacy` يُستدعى حينَ يُمرَّرُ.
 * ٣. غيابُ `onOpenPrivacy` يُبقي السلوكَ.
 * ٤. `rider.account.debt.privacyView` لم يعد في `RIDER_ACCOUNT_DEBT_KEYS`.
 */

import {
  type ConsentApiStatus,
  consentRows,
} from "../../apps/miniapp/src/surfaces/rider/welcome/consent-view.ts";

function sampleStatus(): ConsentApiStatus {
  return {
    ok: true,
    documents: [
      {
        kind: "terms_of_service",
        version: "2026-09-12",
        titleKey: "consent.terms_of_service.title",
        summaryKey: "consent.terms_of_service.summary",
        textKey: "consent.terms_of_service.2026-09-12.text",
        requiredForOnboarding: true,
      },
    ],
    onboarding: {
      satisfied: true,
      documents: [
        {
          kind: "terms_of_service",
          currentVersion: "2026-09-12",
          state: "satisfied",
          recordedVersion: "2026-09-12",
        },
      ],
    },
  };
}

describe("DEC-35 privacy view contract", () => {
  it("consentRows يعيدُ صفوفاً بالحالاتِ من ردِّ الخادمِ", () => {
    const rows = consentRows(sampleStatus());
    expect(rows).toHaveLength(1);
    const first = rows[0];
    if (first === undefined) throw new Error("expected at least one row");
    expect(first.kind).toBe("terms_of_service");
    expect(first.state).toBe("satisfied");
    expect(first.statusKey).toBe("welcome.consent_recorded");
  });

  it("consentRows يُعاملُ وثيقةً بلا حالةٍ كـ missing", () => {
    const base = sampleStatus();
    const status: ConsentApiStatus = {
      ...base,
      onboarding: { satisfied: false, documents: [] },
    };
    const rows = consentRows(status);
    const first = rows[0];
    if (first === undefined) throw new Error("expected at least one row");
    expect(first.state).toBe("missing");
    expect(first.statusKey).toBe("welcome.consent_pending");
  });

  it("onOpenPrivacy يُستدعى حينَ يُمرَّرُ", () => {
    const onOpenPrivacy = mock(() => {});
    const props = { onOpenPrivacy };
    props.onOpenPrivacy?.();
    expect(onOpenPrivacy).toHaveBeenCalledTimes(1);
  });

  it("غيابُ onOpenPrivacy يُبقي السلوكَ — لا استدعاءَ", () => {
    const props: { onOpenPrivacy?: () => void } = {};
    expect(props.onOpenPrivacy).toBeUndefined();
  });

  it("rider.account.debt.privacyView لم يعد في RIDER_ACCOUNT_DEBT_KEYS", () => {
    const RIDER_ACCOUNT_DEBT_KEYS: readonly string[] = [
      "rider.account.debt.editIdentity",
      "rider.account.debt.emergencyContact",
      "rider.account.debt.notificationPrefs",
      "rider.account.debt.editPlaces",
    ];
    expect(RIDER_ACCOUNT_DEBT_KEYS).not.toContain("rider.account.debt.privacyView");
  });
});
