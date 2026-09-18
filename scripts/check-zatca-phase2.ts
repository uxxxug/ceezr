/**
 * الغرض: حاجزٌ ساكنٌ يُثبِتُ عناصرَ المرحلةِ الثانيةِ من امتثال ZATCA (F12-12):
 *   UUID، تجزئة، PIH، ICV، UBL 2.1، حالةُ إبلاغ.
 * الحالة: منفَّذٌ — البندُ F12-12.
 * ينتمي إلى: scripts
 * الحاكم: ADR 0127 · ADR 0039
 * المصادر: ZATCA E-Invoicing Implementation Resolution · ZATCA Detailed Technical Guidelines
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_PATH = resolve(
  import.meta.dir,
  "../supabase/migrations/20260918080000_f12_12_zatca_phase2.sql",
);

const migration = readFileSync(MIGRATION_PATH, "utf-8");

let pass = 0;
let fail = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

function checkInMigration(needle: string, label: string): void {
  check(migration.includes(needle), label);
}

// ── ١) الأعمدةُ الجديدةُ على سجلِّ الفواتير ────────────────────────────────────

checkInMigration("add column if not exists invoice_uuid", "عمودُ UUID للفاتورة");
checkInMigration("add column if not exists invoice_hash", "عمودُ تجزئة الفاتورة");
checkInMigration("add column if not exists previous_invoice_hash", "عمودُ PIH");
checkInMigration("add column if not exists invoice_counter", "عمودُ العدّاد (ICV)");
checkInMigration("add column if not exists ubl_xml", "عمودُ UBL XML");
checkInMigration("add column if not exists reporting_status", "عمودُ حالة الإبلاغ");
checkInMigration("add column if not exists reported_at", "عمودُ وقت الإبلاغ");

// ── ٢) القيود ──────────────────────────────────────────────────────────────────

checkInMigration("subscription_invoices_phase2_all_or_none", "قيدُ الكلِّ أو لا شيء للمرحلة الثانية");
checkInMigration("subscription_invoices_reporting_status_valid", "قيدُ حالة الإبلاغ الصحيحة");
checkInMigration("'PENDING', 'REPORTED', 'REJECTED'", "قيمُ حالة الإبلاغ الثلاث");

// ── ٣) بذرةُ PIH ───────────────────────────────────────────────────────────────

checkInMigration("zatca_pih_seed", "إعدادُ بذرة PIH");
checkInMigration(
  "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==",
  "قيمةُ بذرة PIH المعتمدة من ZATCA",
);

// ── ٤) الدوال ─────────────────────────────────────────────────────────────────

checkInMigration("zatca_generate_invoice_uuid", "دالّةُ توليد UUID");
checkInMigration("zatca_invoice_hash", "دالّةُ تجزئة الفاتورة");
checkInMigration("zatca_previous_invoice_hash", "دالّةُ PIH");
checkInMigration("zatca_next_invoice_counter", "دالّةُ العدّاد المتسلسل");
checkInMigration("zatca_generate_ubl_xml", "دالّةُ توليد UBL 2.1 XML");
checkInMigration("zatca_verify_invoice_chain", "دالّةُ التحقُّق من السلسلة");
checkInMigration("mark_subscription_invoice_reported", "دالّةُ تسجيل حالة الإبلاغ");

// ── ٥) UBL 2.1 ────────────────────────────────────────────────────────────────

checkInMigration("reporting:1.0", "ProfileID للفواتير المبسطة");
checkInMigration("0200000", "InvoiceTypeCode للفاتورة المبسطة");
checkInMigration("cbc:UUID", "UUID في UBL");
checkInMigration("cbc:InvoiceCounterValue", "ICV في UBL");
checkInMigration("PreviousInvoiceHash", "PIH في UBL");
checkInMigration("cac:AccountingSupplierParty", "طرفُ البائع في UBL");
checkInMigration("cac:TaxTotal", "إجمالي الضريبة في UBL");
checkInMigration("cac:LegalMonetaryTotal", "الإجمالي النقدي في UBL");

// ── ٦) تعديلُ الكاتبِ ─────────────────────────────────────────────────────────

checkInMigration("zatca_generate_invoice_uuid()", "توليدُ UUID في الكاتب");
checkInMigration("zatca_previous_invoice_hash(", "PIH في الكاتب");
checkInMigration("zatca_next_invoice_counter(", "ICV في الكاتب");
checkInMigration("zatca_generate_ubl_xml(", "UBL XML في الكاتب");
checkInMigration("zatca_invoice_hash(", "التجزئة في الكاتب");

// ─ـ ٧) تحديثُ الحمولة ─────────────────────────────────────────────────────────

checkInMigration("'invoice_uuid', p_row.invoice_uuid", "UUID في الحمولة");
checkInMigration("'invoice_hash', p_row.invoice_hash", "التجزئة في الحمولة");
checkInMigration("'previous_invoice_hash', p_row.previous_invoice_hash", "PIH في الحمولة");
checkInMigration("'invoice_counter', p_row.invoice_counter", "ICV في الحمولة");
checkInMigration("'ubl_xml', p_row.ubl_xml", "UBL XML في الحمولة");
checkInMigration("'reporting_status', p_row.reporting_status", "حالة الإبلاغ في الحمولة");

// ── ٨) سلبُ التنفيذ ───────────────────────────────────────────────────────────

checkInMigration(
  "revoke all on function zatca_generate_invoice_uuid() from public, anon, authenticated",
  "سلبُ التنفيذ من generate_invoice_uuid",
);
checkInMigration(
  "revoke all on function zatca_invoice_hash(text) from public, anon, authenticated",
  "سلبُ التنفيذ من invoice_hash",
);
checkInMigration(
  "revoke all on function zatca_generate_ubl_xml(",
  "سلبُ التنفيذ من generate_ubl_xml",
);
checkInMigration(
  "revoke all on function zatca_previous_invoice_hash(uuid) from public, anon, authenticated",
  "سلبُ التنفيذ من previous_invoice_hash",
);
checkInMigration(
  "revoke all on function zatca_next_invoice_counter(uuid) from public, anon, authenticated",
  "سلبُ التنفيذ من next_invoice_counter",
);
checkInMigration(
  "revoke all on function zatca_verify_invoice_chain(uuid) from public, anon, authenticated",
  "سلبُ التنفيذ من verify_invoice_chain",
);
checkInMigration(
  "revoke all on function mark_subscription_invoice_reported(uuid, text, text) from public, anon, authenticated",
  "سلبُ التنفيذ من mark_subscription_invoice_reported",
);

// ── ٩) تعديلُ الكاتبِ يشملُ عناصرَ المرحلةِ الثانيةِ ───────────────────────────

checkInMigration("v_invoice_uuid := zatca_generate_invoice_uuid()", "توليد UUID قبل INSERT");
checkInMigration("v_pih := zatca_previous_invoice_hash(", "جلب PIH قبل INSERT");
checkInMigration("v_icv := zatca_next_invoice_counter(", "جلب ICV قبل INSERT");
checkInMigration("v_ubl_xml := zatca_generate_ubl_xml(", "توليد UBL قبل INSERT");
checkInMigration("v_invoice_hash := zatca_invoice_hash(", "حساب التجزئة قبل INSERT");

// ── النتيجة ───────────────────────────────────────────────────────────────────

if (fail > 0) {
  console.error(`\n✗ امتثال ZATCA المرحلة الثانية (F12-12): ${fail} عنصراً مفقوداً`);
  process.exit(1);
}

console.log(
  `✓ امتثال ZATCA المرحلة الثانية (F12-12): ${pass} عنصراً مُثبَتاً — UUID وتجزئة وPIH وICV وUBL 2.1.`,
);
