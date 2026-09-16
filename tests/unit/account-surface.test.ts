/**
 * الغرض: قياسُ لبِّ سطحِ الحسابِ ومُهايئَي الدورَينِ وحاجزِ عقدِه —
 *   **حالةٌ سلبيّةٌ مبذورةٌ لكلِّ قاعدةٍ من الثمانِ** (`ح-7`: قاعدةٌ بلا حالةٍ
 *   سلبيّةٍ غيرُ مُنفَذةٍ) (`SD-12`).
 * الحالة: منفَّذٌ فعليّاً — البند `SD-12`. حكمُ CI يُقرأُ بعدَ الدفعِ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * الحاكم: docs/adr/0126-one-account-core-two-roles.md
 *
 * ولماذا تُقاسُ مدخلاتٌ مصنوعةٌ والمستودعُ معاً: المستودعُ اليومَ نظيفٌ، فلو
 * قِيسَ وحدَه لَنجحَ الاختبارُ ولو كانَ الحاجزُ لا يفحصُ شيئاً. **والحاجزُ الذي
 * لم يُرَ ساقطاً مرّةً لا يُعرَفُ أنّه يقفُ.**
 *
 * وأمّا `tests/unit/data-rights.test.ts` فيبقى كما هوَ **بلا سطرٍ مُعدَّلٍ**:
 * هوَ الذي يقيسُ أنَّ أسماءَ تصديرِ مُهايئِ الراكبِ لم تتغيَّرْ بعدَ نقلِ
 * المنطقِ إلى اللبِّ — وقياسٌ بقيَ أخضرَ بلا تعديلٍ أصدقُ من قياسٍ عُدِّلَ ليخضرَّ.
 */

import { describe, expect, it } from "bun:test";
import { minorUnitsToMajorText } from "../../packages/domain/financial/minor-units.ts";
import {
  accountViewModel,
  exportSectionCount,
  isRetryableAccountError,
  toReceiptView,
} from "../../apps/miniapp/src/surfaces/account/account-view.ts";
import {
  DRIVER_ACCOUNT_DEBT_KEYS,
  DRIVER_ACCOUNT_SPEC,
  driverAccountView,
} from "../../apps/miniapp/src/surfaces/driver/account/account-view.ts";
import {
  RIDER_ACCOUNT_SPEC,
  riderAccountView,
} from "../../apps/miniapp/src/surfaces/rider/account/account-view.ts";
import { readRepository } from "../../scripts/check-account-surface-contract.ts";
import {
  ACCOUNT_ROLES,
  type AccountSurfaceContractInput,
  accountSurfaceContractProblems,
  DOMAIN_ERASURE_REFUSALS,
  DOMAIN_EXPORT_REFUSALS,
  DOMAIN_RETENTION_BASES,
  receiptSectionsFromSql,
} from "../../scripts/lib/account-surface-contract.ts";

/* ────────────────────────── اللبُّ المشتركُ ────────────────────────── */

describe("لبُّ سطحِ الحسابِ", () => {
  const view = accountViewModel({
    keyPrefix: "probe.account.",
    declaredDebtKeys: ["probe.account.debt.one"],
  });

  it("يُنتِجُ مفتاحاً مسبوقاً ببادئةِ الدورِ لكلِّ أساسِ إبقاءٍ معروفٍ", () => {
    for (const basis of DOMAIN_RETENTION_BASES) {
      expect(view.retentionBasisKey(basis)).toBe(`probe.account.basis.${basis}`);
    }
  });

  it("يعرفُ أساسَ الإبقاءِ الذي كانَ يُعرَضُ مجهولاً قبلَ هذا البندِ", () => {
    // العطبُ الحقيقيُّ: `KNOWN_BASES` كانَ خمسةً والنطاقُ تسعةً، وهذا الأساسُ
    // يُرسَلُ في إيصالِ **كلِّ** حذفٍ (`identityBar`) فكانَ يُقرأُ «سببٌ لا نعرفُه».
    expect(view.retentionBasisKey("BLOCK_AND_STANDING_SURVIVE_ERASURE")).toBe(
      "probe.account.basis.BLOCK_AND_STANDING_SURVIVE_ERASURE",
    );
    expect(view.retentionBasisKey("ATTENDANCE_PROVES_DRIVER_ENTITLEMENT")).toBe(
      "probe.account.basis.ATTENDANCE_PROVES_DRIVER_ENTITLEMENT",
    );
    expect(view.retentionBasisKey("DISPATCH_DECISION_IS_EVIDENCE_FOR_THE_OTHER_PARTY")).toBe(
      "probe.account.basis.DISPATCH_DECISION_IS_EVIDENCE_FOR_THE_OTHER_PARTY",
    );
  });

  it("يسقطُ إلى المجهولِ عندَ رمزٍ من خادمٍ أحدثَ", () => {
    expect(view.retentionBasisKey("A_BASIS_FROM_TOMORROW")).toBe("probe.account.basis.UNKNOWN");
    expect(view.erasureRefusalKey("A_REFUSAL_FROM_TOMORROW")).toBe(
      "probe.account.erasure.refusal.UNKNOWN",
    );
    expect(view.exportRefusalKey("A_REFUSAL_FROM_TOMORROW")).toBe(
      "probe.account.export.refusal.UNKNOWN",
    );
    expect(view.accountErrorKey("A_CODE_FROM_TOMORROW")).toBe("probe.account.error.UNKNOWN");
  });

  it("يمرِّرُ كلَّ رفضٍ ورمزِ عطبٍ معروفٍ بلا سقوطٍ", () => {
    for (const refusal of DOMAIN_ERASURE_REFUSALS) {
      expect(view.erasureRefusalKey(refusal)).toBe(`probe.account.erasure.refusal.${refusal}`);
    }
    for (const refusal of DOMAIN_EXPORT_REFUSALS) {
      expect(view.exportRefusalKey(refusal)).toBe(`probe.account.export.refusal.${refusal}`);
    }
  });

  it("لا يُسقِطُ قسمَ إيصالٍ إلى المجهولِ عن قصدٍ", () => {
    // الأقسامُ مجالٌ يُلزِمُه الحاجزُ بنصٍّ، فسقوطٌ ههنا يُخبِّئُ نقصاً عن CI.
    expect(view.sectionKey("aSectionFromTomorrow")).toBe(
      "probe.account.section.aSectionFromTomorrow",
    );
  });

  it("يقرأُ رصيدَ محفظةٍ غائباً صفراً لا NaN", () => {
    expect(view.walletBalanceText(undefined)).toBe("0.00");
    expect(view.walletBalanceText(4500)).toBe("45.00");
    expect(view.walletBalanceText(-4500)).toBe("-45.00");
    expect(minorUnitsToMajorText(Number.NaN)).toBe("0.00");
  });

  it("يرتّبُ الإيصالَ ويجمعُ ما أُزيلَ", () => {
    const receipt = toReceiptView({
      erased: { savedPlaces: 3, orders: 2 },
      anonymized: { ratings: 1 },
      retained: [
        { section: "identityBar", rows: 1, basis: "BLOCK_AND_STANDING_SURVIVE_ERASURE" },
        { section: "auditTrail", rows: 4, basis: "AUDIT_TRAIL_PROVES_THIS_ERASURE" },
      ],
    });
    expect(receipt.erased.map((line) => line.section)).toEqual(["orders", "savedPlaces"]);
    expect(receipt.retained.map((line) => line.section)).toEqual(["auditTrail", "identityBar"]);
    expect(receipt.totalRemoved).toBe(6);
    expect(receipt.erased.every((line) => line.basis === null)).toBe(true);
  });

  it("يُعيدُ المحاولةَ على عطبِ مخزنٍ لا على انقطاعِ جلسةٍ", () => {
    expect(isRetryableAccountError("PRIVACY_STORE_NOT_AVAILABLE")).toBe(true);
    expect(isRetryableAccountError("UNKNOWN")).toBe(true);
    expect(isRetryableAccountError("SESSION_EXPIRED")).toBe(false);
    expect(isRetryableAccountError("CONFIRMATION_REQUIRED")).toBe(false);
  });

  it("يَعُدُّ أقسامَ الحزمةِ ولا يعرضُ محتواها", () => {
    expect(exportSectionCount({ profile: {}, orders: [], consents: [] })).toBe(3);
    expect(exportSectionCount({})).toBe(0);
  });
});

/* ────────────────────────── مُهايئا الدورَينِ ────────────────────────── */

describe("مُهايئا حسابِ الراكبِ والسائقِ", () => {
  it("يفترقانِ في البادئةِ لا في السلوكِ", () => {
    expect(riderAccountView.keyPrefix).toBe("rider.account.");
    expect(driverAccountView.keyPrefix).toBe("driver.account.");
    for (const basis of DOMAIN_RETENTION_BASES) {
      expect(riderAccountView.retentionBasisKey(basis)).toBe(`rider.account.basis.${basis}`);
      expect(driverAccountView.retentionBasisKey(basis)).toBe(`driver.account.basis.${basis}`);
    }
  });

  it("بادئةُ كلِّ دورٍ تنتهي بنقطةٍ", () => {
    for (const spec of [RIDER_ACCOUNT_SPEC, DRIVER_ACCOUNT_SPEC]) {
      expect(spec.keyPrefix.endsWith(".")).toBe(true);
    }
  });

  it("يُعلِنُ كلُّ مُهايئٍ دَينَه بمفاتيحِ دورِه", () => {
    expect(DRIVER_ACCOUNT_DEBT_KEYS.length).toBeGreaterThan(0);
    for (const key of driverAccountView.declaredDebtKeys) {
      expect(key.startsWith("driver.account.")).toBe(true);
    }
    for (const key of riderAccountView.declaredDebtKeys) {
      expect(key.startsWith("rider.account.")).toBe(true);
    }
  });

  it("يُعلِنُ كلُّ دورٍ في سجلِّ الحاجزِ بمِلفِّ وصفِه", () => {
    // دورٌ يُبنى ولا يُزادُ في `ACCOUNT_ROLES` يمرُّ بلا قياسٍ.
    const prefixes = ACCOUNT_ROLES.map((role) => role.keyPrefix);
    expect(prefixes).toContain(riderAccountView.keyPrefix);
    expect(prefixes).toContain(driverAccountView.keyPrefix);
  });
});

/* ────────────────────────── الحاجزُ: مدخلاتٌ مصنوعةٌ ────────────────────────── */

const SQL = `
create or replace function export_account_data(p_actor uuid)
returns jsonb language plpgsql as $$ begin
  return jsonb_build_object('ok', true, 'sections', jsonb_build_object(
    'profile', jsonb_build_object('name', v_user.name),
    'orders', (select jsonb_agg(jsonb_build_object('id', o.id)) from orders o),
    'identityBar', case when v_bar.id is null then '{}'::jsonb else jsonb_build_object('id', 1) end
  ));
end; $$;

create or replace function erase_account(p_actor uuid)
returns jsonb language plpgsql as $$ begin
  v_retained := jsonb_build_array(jsonb_build_object(
    'section', 'auditTrail', 'rows', 4, 'basis', 'AUDIT_TRAIL_PROVES_THIS_ERASURE'
  ));
end; $$;
`;

const ROLES = [
  { keyPrefix: "rider.account.", specFile: "rider/account-view.ts" },
  { keyPrefix: "driver.account.", specFile: "driver/account-view.ts" },
] as const;

const BASES = ["AUDIT_TRAIL_PROVES_THIS_ERASURE", "BLOCK_AND_STANDING_SURVIVE_ERASURE"] as const;
const ERASURE = ["ACTIVE_ORDER", "WALLET_HAS_BALANCE"] as const;
const EXPORT = ["USER_NOT_FOUND"] as const;
const ERRORS = ["SESSION_REQUIRED"] as const;
const SECTIONS = ["profile", "orders", "identityBar", "auditTrail"] as const;

function dictionary(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of ROLES) {
    for (const basis of BASES) out[`${role.keyPrefix}basis.${basis}`] = "نصٌّ";
    out[`${role.keyPrefix}basis.UNKNOWN`] = "نصٌّ";
    for (const refusal of ERASURE) out[`${role.keyPrefix}erasure.refusal.${refusal}`] = "نصٌّ";
    out[`${role.keyPrefix}erasure.refusal.UNKNOWN`] = "نصٌّ";
    for (const refusal of EXPORT) out[`${role.keyPrefix}export.refusal.${refusal}`] = "نصٌّ";
    out[`${role.keyPrefix}export.refusal.UNKNOWN`] = "نصٌّ";
    for (const code of ERRORS) out[`${role.keyPrefix}error.${code}`] = "نصٌّ";
    out[`${role.keyPrefix}error.UNKNOWN`] = "نصٌّ";
    for (const section of SECTIONS) out[`${role.keyPrefix}section.${section}`] = "نصٌّ";
  }
  return out;
}

function cleanInput(): AccountSurfaceContractInput {
  const shared = dictionary();
  return {
    core: {
      "account/AccountRights.tsx": `const key = makeKey("section.orders"); export const A = 1;`,
      "account/account-view.ts": `export const B = 2;`,
    },
    roleSurfaces: {
      "rider/account-view.ts": `export const RIDER_ACCOUNT_SPEC = { keyPrefix: "rider.account." };`,
      "driver/account-view.ts": `export const DRIVER_ACCOUNT_SPEC = { keyPrefix: "driver.account." };`,
    },
    sqlByPath: { "erasure.sql": SQL },
    translations: { ar: { ...shared }, en: { ...shared }, ur: { ...shared } },
    roles: ROLES,
    retentionBases: BASES,
    erasureRefusals: ERASURE,
    exportRefusals: EXPORT,
    errorCodes: ERRORS,
    allowedPlaceholders: ["orders", "amount"],
  };
}

describe("حاجزُ عقدِ سطحِ الحسابِ — حالةٌ سلبيّةٌ لكلِّ قاعدةٍ (`ح-7`)", () => {
  it("يقرأُ أقسامَ الإيصالِ من جسمِ الدالّةِ لا من سجلٍّ موازٍ", () => {
    expect(receiptSectionsFromSql({ "erasure.sql": SQL })).toEqual([
      "auditTrail",
      "identityBar",
      "orders",
      "profile",
    ]);
  });

  it("يمرُّ على مدخلاتٍ سليمةٍ", () => {
    expect(accountSurfaceContractProblems(cleanInput())).toEqual([]);
  });

  it("١ — يسقطُ عندَ أساسِ إبقاءٍ بلا نصٍّ في لغةٍ واحدةٍ", () => {
    const input = cleanInput();
    const ur: Record<string, string> = { ...input.translations.ur };
    delete ur["driver.account.basis.BLOCK_AND_STANDING_SURVIVE_ERASURE"];
    const problems = accountSurfaceContractProblems({
      ...input,
      translations: { ...input.translations, ur },
    });
    expect(problems.some((p) => p.startsWith("القاعدةُ ١:") && p.includes("BLOCK_AND"))).toBe(true);
  });

  it("١ — يسقطُ عندَ رمزِ عطبٍ نصُّه فراغٌ", () => {
    const input = cleanInput();
    const ar: Record<string, string> = { ...input.translations.ar };
    ar["rider.account.error.SESSION_REQUIRED"] = "   ";
    const problems = accountSurfaceContractProblems({
      ...input,
      translations: { ...input.translations, ar },
    });
    expect(problems.some((p) => p.startsWith("القاعدةُ ١:") && p.includes("SESSION_REQUIRED"))).toBe(
      true,
    );
  });

  it("٢ — يسقطُ عندَ قسمِ إيصالٍ بلا نصٍّ", () => {
    const input = cleanInput();
    const translations = Object.fromEntries(
      Object.entries(input.translations).map(([language, dict]) => {
        const copy: Record<string, string> = { ...dict };
        delete copy["driver.account.section.identityBar"];
        return [language, copy];
      }),
    );
    const problems = accountSurfaceContractProblems({ ...input, translations });
    expect(
      problems.some((p) => p.startsWith("القاعدةُ ٢:") && p.includes("section.identityBar")),
    ).toBe(true);
  });

  it("٢ — يسقطُ عندَ هجرةٍ لا يُقرأُ منها قسمٌ", () => {
    const problems = accountSurfaceContractProblems({
      ...cleanInput(),
      sqlByPath: { "erasure.sql": "-- لا شيءَ ههنا" },
    });
    expect(problems.some((p) => p.includes("لم يُقرَأْ أيُّ قسمِ إيصالٍ"))).toBe(true);
  });

  it("٣ — يسقطُ عندَ مفتاحٍ في لغةٍ وغائبٍ في أختِها", () => {
    const input = cleanInput();
    const en: Record<string, string> = { ...input.translations.en, "rider.account.extra": "x" };
    const problems = accountSurfaceContractProblems({
      ...input,
      translations: { ...input.translations, en },
    });
    expect(problems.some((p) => p.startsWith("القاعدةُ ٣:") && p.includes("rider.account.extra"))).toBe(
      true,
    );
  });

  it("٤ — يسقطُ عندَ غيابِ مفتاحِ سقوطٍ للمجهولِ", () => {
    const input = cleanInput();
    const translations = Object.fromEntries(
      Object.entries(input.translations).map(([language, dict]) => {
        const copy: Record<string, string> = { ...dict };
        delete copy["rider.account.export.refusal.UNKNOWN"];
        return [language, copy];
      }),
    );
    const problems = accountSurfaceContractProblems({ ...input, translations });
    expect(
      problems.some(
        (p) => p.startsWith("القاعدةُ ٤:") && p.includes("export.refusal.UNKNOWN"),
      ),
    ).toBe(true);
  });

  it("٥ — يسقطُ عندَ نسخِ مجالٍ مغلقٍ في سطحِ دورٍ", () => {
    const input = cleanInput();
    const problems = accountSurfaceContractProblems({
      ...input,
      roleSurfaces: {
        ...input.roleSurfaces,
        "driver/account-view.ts":
          `export const DRIVER_ACCOUNT_SPEC = { keyPrefix: "driver.account." };\n` +
          `const KNOWN = new Set(["WALLET_HAS_BALANCE"]);`,
      },
    });
    expect(
      problems.some((p) => p.startsWith("القاعدةُ ٥:") && p.includes("WALLET_HAS_BALANCE")),
    ).toBe(true);
  });

  it("٦ — يسقطُ عندَ ذكرِ بادئةِ دورٍ في اللبِّ", () => {
    const input = cleanInput();
    const problems = accountSurfaceContractProblems({
      ...input,
      core: { ...input.core, "account/account-view.ts": `const p = "driver.account.";` },
    });
    expect(problems.some((p) => p.startsWith("القاعدةُ ٦:") && p.includes("driver.account."))).toBe(
      true,
    );
  });

  it("٧ — يسقطُ عندَ بادئةٍ بلا نقطةٍ", () => {
    const problems = accountSurfaceContractProblems({
      ...cleanInput(),
      roles: [{ keyPrefix: "driver.account", specFile: "driver/account-view.ts" }],
    });
    expect(problems.some((p) => p.startsWith("القاعدةُ ٧:") && p.includes("لا تنتهي بنقطةٍ"))).toBe(
      true,
    );
  });

  it("٧ — يسقطُ عندَ وصفٍ لا يُعلِنُ بادئةَ دورِه", () => {
    const input = cleanInput();
    const problems = accountSurfaceContractProblems({
      ...input,
      roleSurfaces: {
        ...input.roleSurfaces,
        "driver/account-view.ts": `export const DRIVER_ACCOUNT_SPEC = { keyPrefix: "driver." };`,
      },
    });
    expect(problems.some((p) => p.startsWith("القاعدةُ ٧:") && p.includes("keyPrefix"))).toBe(true);
  });

  it("٨ — يسقطُ عندَ نائبٍ لا تستبدلُه الشاشةُ", () => {
    const input = cleanInput();
    const ar: Record<string, string> = { ...input.translations.ar };
    ar["driver.account.erasure.refusal.WALLET_HAS_BALANCE"] = "رصيدُك {balance} ريالاً";
    const problems = accountSurfaceContractProblems({
      ...input,
      translations: { ...input.translations, ar },
    });
    expect(problems.some((p) => p.startsWith("القاعدةُ ٨:") && p.includes("{balance}"))).toBe(true);
  });

  it("٨ — يمرُّ على النوّابِ المسموحةِ", () => {
    const input = cleanInput();
    const ar: Record<string, string> = { ...input.translations.ar };
    ar["driver.account.erasure.refusal.WALLET_HAS_BALANCE"] = "رصيدُك {amount} · طلباتُك {orders}";
    expect(
      accountSurfaceContractProblems({ ...input, translations: { ...input.translations, ar } }),
    ).toEqual([]);
  });
});

/* ────────────────────────── الحاجزُ على المستودعِ الحقيقيِّ ────────────────────────── */

describe("حاجزُ عقدِ سطحِ الحسابِ على المستودعِ", () => {
  it("المستودعُ يمرُّ", () => {
    expect(accountSurfaceContractProblems(readRepository())).toEqual([]);
  });

  it("الأقسامُ المقروءةُ من الهجراتِ الحقيقيّةِ اثنتانِ وثلاثونَ", () => {
    // رقمٌ مُثبَّتٌ **يُرفَعُ إضافةً** عندَ قسمٍ جديدٍ ولا يُعطَّلُ (`ح-8`).
    expect(receiptSectionsFromSql(readRepository().sqlByPath).length).toBe(32);
  });

  it("كلُّ دورٍ في السجلِّ له مِلفُّ وصفٍ مقروءٌ", () => {
    const input = readRepository();
    for (const role of ACCOUNT_ROLES) {
      expect(Object.keys(input.roleSurfaces)).toContain(role.specFile);
    }
  });
});
