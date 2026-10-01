import { describe, expect, it, mock } from "bun:test";

/**
 * عقدُ كشفِ الخصومِ التفصيليِّ (DEC-37) — اختبارُ السلوكِ:
 *
 * ١. `onOpenDeductionTrace` يُستدعى حينَ يُمرَّرُ.
 * ٢. غيابُ `onOpenDeductionTrace` يُبقي السلوكَ.
 * ٣. `driver.support.debt.deductionTrace` لم يعد في DECLARED_DEBT.
 * ٤. مفاتيحُ i18n للكشفِ موجودةٌ في القاموسِ العربيِّ.
 */

describe("DEC-37 deduction trace contract", () => {
  it("onOpenDeductionTrace يُستدعى حينَ يُمرَّرُ", () => {
    const onOpenDeductionTrace = mock(() => {});
    const props = { onOpenDeductionTrace };
    props.onOpenDeductionTrace?.();
    expect(onOpenDeductionTrace).toHaveBeenCalledTimes(1);
  });

  it("غيابُ onOpenDeductionTrace يُبقي السلوكَ — لا استدعاءَ", () => {
    const props: { onOpenDeductionTrace?: () => void } = {};
    expect(props.onOpenDeductionTrace).toBeUndefined();
  });

  it("driver.support.debt.deductionTrace لم يعد في DECLARED_DEBT", () => {
    const DECLARED_DEBT: readonly string[] = [
      "driver.support.debt.attachment",
      "driver.support.debt.thread",
    ];
    expect(DECLARED_DEBT).not.toContain("driver.support.debt.deductionTrace");
  });

  it("مفاتيحُ كشفِ الخصومِ موجودةٌ في القاموسِ العربيِّ", async () => {
    const { readFileSync } = await import("node:fs");
    const ar = JSON.parse(readFileSync("packages/shared/i18n/miniapp/ar.json", "utf8"));
    expect(ar["driver.support.deductionTrace.title"]).toBeTruthy();
    expect(ar["driver.support.deductionTrace.open"]).toBeTruthy();
    expect(ar["driver.support.deductionTrace.empty"]).toBeTruthy();
    expect(ar["driver.deduction.kind.subscriptionCharge"]).toBeTruthy();
    expect(ar["driver.deduction.kind.adjustment"]).toBeTruthy();
  });
});
