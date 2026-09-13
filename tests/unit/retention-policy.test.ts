/**
 * الغرض: `F7-06` — سياسةُ الاستبقاءِ مصدرُ حقيقةٍ واحدٌ، وحاجزُها يكشفُ الفراغَ
 *   في الاتجاهَينِ. البند `F7-06`، `ADR-0075`، `DEC-15`.
 * الحالة: اختبار وحدة — لا قاعدةَ ولا شبكةَ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أيُّ جدولٍ جديدٍ في المخطّطِ.
 * ملاحظات مستقبلية: يومَ يُحسَمُ `F12-10` تُستبدَلُ `pending-decision` بمُدَدٍ،
 *   ويبقى هذا الملفُّ كما هوَ.
 */

import { describe, expect, it } from "bun:test";
import {
  DEC_15,
  isAutomatedRemovalForbidden,
  LOCATION_HOT_DAYS,
  RETENTION_CLASSES,
  TABLE_RETENTION,
} from "../../packages/shared/config/retention-policy.ts";
import { retentionGaps, tablesInMigrations } from "../../scripts/check-retention-policy.ts";

describe("F7-06 — سياسةُ الاستبقاءِ", () => {
  it("١) كلُّ جدولٍ في الهجراتِ مُصنَّفٌ، ولا مُدخلَ ميّتاً في التصنيفِ", () => {
    const tables = tablesInMigrations();
    const { unclassified, orphaned } = retentionGaps(tables, TABLE_RETENTION);
    expect(unclassified).toEqual([]);
    expect(orphaned).toEqual([]);
    expect(tables.length).toBeGreaterThan(40);
  });

  it("٢) المدّةُ الساخنةُ تُقرَأُ من القرارِ لا من رقمٍ ثانٍ", () => {
    expect(LOCATION_HOT_DAYS).toBe(DEC_15.locationHotDays);
    expect(DEC_15.locationDisposition).toBe("archive-outside-database");
  });

  it("٣) سجلُّ التدقيقِ بلا مدّةٍ — و`null` قرارٌ مكتوبٌ لا سهوٌ", () => {
    expect(DEC_15.auditLogDays).toBeNull();
    expect(TABLE_RETENTION.audit_log).toBe(RETENTION_CLASSES.auditUnboundedUntilCompliance);
  });

  it("٤) **الجدولُ الوحيدُ الذي يجوزُ إخراجُ صفوفِه آليّاً هوَ تاريخُ الموقعِ**", () => {
    const allowed = Object.keys(TABLE_RETENTION).filter(
      (table) => !isAutomatedRemovalForbidden(table),
    );
    expect(allowed).toEqual(["driver_location_history"]);
  });

  it("٥) الجداولُ الماليّةُ مصنّفةٌ صنفاً يمنعُ الإخراجَ الآليَّ", () => {
    for (const table of [
      "ledger_entries",
      "payment_transactions",
      "subscription_invoices",
      "subscription_refunds",
      "subscription_wallet_entries",
      "subscriptions",
    ]) {
      expect(TABLE_RETENTION[table]).toBe(RETENTION_CLASSES.financialSixYears);
      expect(isAutomatedRemovalForbidden(table)).toBe(true);
    }
  });
});
