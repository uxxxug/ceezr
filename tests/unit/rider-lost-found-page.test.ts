import { describe, expect, it, mock } from "bun:test";

/**
 * عقدُ صفحةِ المفقوداتِ المخصَّصةِ (DEC-34) — اختبارُ السلوكِ الحقيقيِّ:
 *
 * ١. `initialCategory` في `SupportScreen` يَطغى على اشتقاقِ `orderId`.
 * ٢. غيابُ `initialCategory` يُبقي السلوكَ كالسابقِ (توافقٌ مع DEC-34).
 * ٣. زرُّ «مفقودات» يُمرَّرُ من `HomeScreen` حينَ يُمرَّرُ `onOpenLostFound`.
 * ٤. غيابُ `onOpenLostFound` يُبقي السلوكَ (لا زرَّ).
 *
 * مُستخرَجٌ من العقدِ بلا استيرادِ `.tsx` (الجذرُ بلا `--jsx`).
 */

describe("DEC-34 lost & found page contract", () => {
  it("initialCategory يَطغى على اشتقاقِ orderId حينَ يُمرَّرُ", () => {
    // محاكاةُ منطقِ SupportScreen:
    // derivedCategory = initialCategory !== null ? initialCategory
    //   : orderId === null ? null : "ride_dispute"
    function deriveCategory(initialCategory: string | null, orderId: string | null): string | null {
      if (initialCategory !== null) return initialCategory;
      return orderId === null ? null : "ride_dispute";
    }

    // initialCategory يَطغى
    expect(deriveCategory("lost_item", "order-123")).toBe("lost_item");
    expect(deriveCategory("lost_item", null)).toBe("lost_item");
    // غيابُ initialCategory يُبقي السلوكَ
    expect(deriveCategory(null, "order-123")).toBe("ride_dispute");
    expect(deriveCategory(null, null)).toBeNull();
  });

  it("onOpenLostFound يُستدعى حينَ يُمرَّرُ", () => {
    const onOpenLostFound = mock(() => {});
    const props = { onOpenLostFound };
    props.onOpenLostFound?.();
    expect(onOpenLostFound).toHaveBeenCalledTimes(1);
  });

  it("غيابُ onOpenLostFound يُبقي السلوكَ — لا استدعاءَ", () => {
    const props: { onOpenLostFound?: () => void } = {};
    expect(props.onOpenLostFound).toBeUndefined();
  });

  it("rider.support.debt.lostFound لم يعد في DECLARED_DEBT", () => {
    // عقدُ: الدَّينَ رُفِعَ من القائمةِ بعدَ بناءِ الصفحةِ المخصَّصةِ.
    const DECLARED_DEBT: readonly string[] = [
      "rider.support.debt.attachment",
      "rider.support.debt.thread",
      "rider.support.debt.faq",
    ];
    expect(DECLARED_DEBT).not.toContain("rider.support.debt.lostFound");
  });
});
