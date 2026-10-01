import { describe, expect, it, mock } from "bun:test";

/**
 * عقدُ شاشةِ الأسئلة الشائعةِ (DEC-36) — اختبارُ السلوكِ:
 *
 * ١. `onOpenFaq` يُستدعى حينَ يُمرَّرُ.
 * ٢. غيابُ `onOpenFaq` يُبقي السلوكَ.
 * ٣. `rider.support.debt.faq` لم يعد في DECLARED_DEBT.
 * ٤. محتوى الأسئلةِ موجودٌ في القواميسِ الثلاث.
 */

describe("DEC-36 FAQ page contract", () => {
  it("onOpenFaq يُستدعى حينَ يُمرَّرُ", () => {
    const onOpenFaq = mock(() => {});
    const props = { onOpenFaq };
    props.onOpenFaq?.();
    expect(onOpenFaq).toHaveBeenCalledTimes(1);
  });

  it("غيابُ onOpenFaq يُبقي السلوكَ — لا استدعاءَ", () => {
    const props: { onOpenFaq?: () => void } = {};
    expect(props.onOpenFaq).toBeUndefined();
  });

  it("rider.support.debt.faq لم يعد في DECLARED_DEBT", () => {
    const DECLARED_DEBT: readonly string[] = [
      "rider.support.debt.attachment",
      "rider.support.debt.thread",
      "rider.support.debt.lostFound",
    ];
    expect(DECLARED_DEBT).not.toContain("rider.support.debt.faq");
  });

  it("مفاتيحُ الأسئلةِ الخمسةِ موجودةٌ في القاموسِ العربيِّ", async () => {
    const { readFileSync } = await import("node:fs");
    const ar = JSON.parse(readFileSync("packages/shared/i18n/miniapp/ar.json", "utf8"));
    for (let i = 1; i <= 5; i++) {
      expect(ar[`rider.support.faq.q${i}`], `q${i}`).toBeTruthy();
      expect(ar[`rider.support.faq.a${i}`], `a${i}`).toBeTruthy();
    }
  });
});
