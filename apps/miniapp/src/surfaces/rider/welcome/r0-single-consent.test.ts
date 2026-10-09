/**
 * الغرض: R0 · ADR 0254 — «أوافق وأتابع» واحدٌ يسجّلُ كلَّ وثيقةٍ معلّقةٍ بإصدارِها في طلبٍ مستقلّ، بالتتابع،
 *   ولا يعيدُ ما وُوفِقَ عليه، ويتوقّفُ عندَ أوّلِ رفضٍ فتُعادُ المحاولةُ للمعلّقِ وحدَه.
 * الحالة: منفّذ فعلياً.
 */

import { describe, expect, it } from "bun:test";
import {
  MINIAPP_LANGUAGES,
  miniAppDictionary,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import {
  type ConsentApiStatus,
  consentRows,
  outstandingRows,
  recordPendingInOrder,
} from "./consent-view.ts";

const SOURCE = await Bun.file(new URL("./WelcomeScreen.tsx", import.meta.url)).text();

function status(states: Record<string, "missing" | "satisfied" | "superseded">): ConsentApiStatus {
  const documents = Object.keys(states).map((kind) => ({
    kind,
    version: `${kind}-v2`,
    titleKey: `t.${kind}`,
    summaryKey: `s.${kind}`,
    textKey: `x.${kind}`,
    requiredForOnboarding: true,
  }));
  return {
    ok: true,
    documents,
    onboarding: {
      satisfied: Object.values(states).every((s) => s === "satisfied"),
      documents: Object.entries(states).map(([kind, state]) => ({
        kind,
        currentVersion: `${kind}-v2`,
        state,
      })),
    },
  };
}

describe("R0 — الموافقةُ الموحّدة", () => {
  it("١) ترسلُ كلَّ وثيقةٍ معلّقةٍ بإصدارِها الحاليّ بالترتيب، طلباً لكلّ وثيقة", async () => {
    const calls: [string, string][] = [];
    const pending = outstandingRows(
      consentRows(status({ terms: "missing", privacy: "superseded" })),
    );
    const result = await recordPendingInOrder(pending, async (kind, version) => {
      calls.push([kind, version]);
    });
    expect(calls).toEqual([
      ["terms", "terms-v2"],
      ["privacy", "privacy-v2"],
    ]);
    expect(result).toEqual({ recorded: ["terms", "privacy"], failure: null });
  });

  it("٢) ما وُوفِقَ عليه بإصدارِه الحاليّ لا يُعادُ إرسالُه", async () => {
    const calls: string[] = [];
    const pending = outstandingRows(
      consentRows(status({ terms: "satisfied", privacy: "missing" })),
    );
    await recordPendingInOrder(pending, async (kind) => {
      calls.push(kind);
    });
    expect(calls).toEqual(["privacy"]);
  });

  it("٣) أوّلُ رفضٍ يوقِفُ التتابعَ ويعيدُ وثيقتَه، وإعادةُ المحاولةِ ترسلُ الباقيَ وحدَه", async () => {
    const calls: string[] = [];
    const first = outstandingRows(consentRows(status({ terms: "missing", privacy: "missing" })));
    const failed = await recordPendingInOrder(first, async (kind) => {
      calls.push(kind);
      if (kind === "privacy") throw { code: "CONSENT_STORE_NOT_AVAILABLE" };
    });
    expect(failed.recorded).toEqual(["terms"]);
    expect(failed.failure?.kind).toBe("privacy");
    // الخادمُ سجّلَ `terms`؛ القراءةُ التاليةُ تجعلُ `privacy` وحدَها معلّقة.
    const retry = outstandingRows(consentRows(status({ terms: "satisfied", privacy: "missing" })));
    await recordPendingInOrder(retry, async (kind) => {
      calls.push(kind);
    });
    expect(calls).toEqual(["terms", "privacy", "privacy"]);
  });

  it("٤) الشاشة: زرٌّ أساسيٌّ واحدٌ، ونصُّ إفصاحٍ قبلَه، والمتابعةُ بحكمِ الخادمِ وحدَه", () => {
    expect(SOURCE).toContain('t("welcome.accept_all")');
    expect(SOURCE).toContain('t("welcome.accept_all_note")');
    expect(SOURCE).toContain("failure === null && alreadyOnboarded(status) && onProceed");
    // الوثيقةُ المطلوبةُ بلا زرٍّ منفصل؛ الاختياريّةُ (إن وُجدَت) تبقى بزرِّها.
    expect(SOURCE).toContain("{done || row.required ? null : (");
    // عنصرُ قياسِ السطحِ الأوّلِ باقٍ في مكانِه.
    expect(SOURCE).toContain("{...riderSurfaceTimingAttribute}");
  });

  it("٥) النصوصُ في اللغاتِ الثلاث", () => {
    for (const language of MINIAPP_LANGUAGES) {
      const dictionary = miniAppDictionary(language);
      expect(dictionary["welcome.accept_all"]).toBeString();
      expect(dictionary["welcome.accept_all_note"]).toBeString();
    }
  });
});
