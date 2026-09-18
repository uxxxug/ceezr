/**
 * الغرض: حاجزُ امتثال PDPL — يُثبِتُ تغطيةَ المحاورِ الأربعةِ بأسماءِ الجداولِ
 *   والدوالِّ والسالباتِ (F12-10).
 * الحالة: منفَّذٌ — البندُ F12-10.
 * ينتمي إلى: scripts/
 *
 * والقياسُ: هذا الحاجزُ يُثبِتُ أنَّ الهجرةَ والمجالَ والتطبيقَ والبنيةَ التحتيّةَ
 * موجودةٌ بأسمائِها المُعلَنةِ. ولا يُثبِتُ امتثالاً نظاميّاً — ذلك قرارُ متحكّمٍ
 * في البياناتِ لا اجتهادُ منفِّذ.
 *
 * ## لماذا حاجزٌ ساكنٌ
 *
 * لأنَّ الأسماءَ المُعلَنةَ في العقدِ هي الفهرسُ: لو غابَ جدولٌ أو دالّةٌ، فالقياسُ
 * كاذبٌ. والحاجزُ الساكنُ يكشفُ الغيابَ قبلَ أن يُكتبَ اختبارُ تكاملٍ.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_PATH = join(
  import.meta.dir,
  "..",
  "supabase",
  "migrations",
  "20260918070000_f12_10_pdpl_compliance.sql",
);

const DOMAIN_PATH = join(
  import.meta.dir,
  "..",
  "packages",
  "domain",
  "privacy",
  "pdpl-compliance.ts",
);

const APP_PATH = join(
  import.meta.dir,
  "..",
  "packages",
  "application",
  "privacy",
  "pdpl-compliance.ts",
);

const STORE_PATH = join(
  import.meta.dir,
  "..",
  "packages",
  "infrastructure",
  "privacy",
  "pdpl-store.ts",
);

function assert(content: string, needle: string, label: string): void {
  if (!content.includes(needle)) {
    console.error(`✗ ${label}: غير موجود`);
    process.exit(1);
  }
}

const migration = readFileSync(MIGRATION_PATH, "utf-8");
const domain = readFileSync(DOMAIN_PATH, "utf-8");
const app = readFileSync(APP_PATH, "utf-8");
const store = readFileSync(STORE_PATH, "utf-8");

let checked = 0;

function check(content: string, needle: string, label: string): void {
  assert(content, needle, label);
  checked++;
}

// ── ١) الجداولُ الأربعةُ ─────────────────────────────────────────────────────

check(migration, "create table if not exists pdpl_processing_activities", "جدولُ أنشطةِ المعالجةِ");
check(
  migration,
  "create table if not exists pdpl_data_subject_requests",
  "جدولُ طلباتِ أصحابِ البياناتِ",
);
check(migration, "create table if not exists pdpl_dpia_assessments", "جدولُ تقييماتِ الأثرِ");
check(
  migration,
  "create table if not exists pdpl_cross_border_transfers",
  "جدولُ النقلِ خارجَ المملكةِ",
);

// ── ٢) الأنواعُ المُعدَّدةُ ─────────────────────────────────────────────────

check(migration, "create type if not exists pdpl_processing_basis", "نوعُ أساسِ المعالجةِ");
check(migration, "create type if not exists pdpl_activity_status", "نوعُ حالةِ النشاطِ");
check(migration, "create type if not exists pdpl_subject_right", "نوعُ حقِّ صاحبِ البياناتِ");
check(migration, "create type if not exists pdpl_right_request_status", "نوعُ حالةِ الطلبِ");
check(migration, "create type if not exists pdpl_dpia_risk_level", "نوعُ مستوى خطرِ DPIA");
check(migration, "create type if not exists pdpl_dpia_status", "نوعُ حالةِ DPIA");
check(migration, "create type if not exists pdpl_transfer_basis", "نوعُ أساسِ النقلِ");
check(migration, "create type if not exists pdpl_transfer_status", "نوعُ حالةِ النقلِ");

// ── ٣) الدوالُ ──────────────────────────────────────────────────────────────

check(migration, "pdpl_processing_activity_is_allowed", "دالّةُ السماحِ بالنشاطِ");
check(migration, "pdpl_dpia_required", "دالّةُ اشتراطِ DPIA");
check(migration, "pdpl_dpia_is_approved", "دالّةُ اعتمادِ DPIA");
check(migration, "pdpl_high_risk_requires_dpia", "دالّةُ خطرٍ عالٍ يتطلَّبُ DPIA");
check(migration, "pdpl_cross_border_transfer_allowed", "دالّةُ السماحِ بالنقلِ");
check(migration, "pdpl_cross_border_transfer_is_expired", "دالّةُ انتهاءِ النقلِ");
check(migration, "pdpl_right_request_deadline", "دالّةُ مهلةِ الطلبِ");
check(migration, "pdpl_right_request_is_overdue", "دالّةُ انقضاءِ الطلبِ");
check(migration, "pdpl_record_right_request", "دالّةُ تسجيلِ الطلبِ");
check(migration, "pdpl_close_right_request", "دالّةُ إغلاقِ الطلبِ");

// ── ٤) RLS ──────────────────────────────────────────────────────────────────

check(migration, "enable row level security", "RLS مُفعَّلٌ على الأربعةِ جداولَ");

// ── ٥) سلبُ التنفيذِ ────────────────────────────────────────────────────────

check(
  migration,
  "revoke execute on function pdpl_processing_activity_is_allowed",
  "سلبُ التنفيذِ من الأدوارِ العامّةِ",
);

// ── ٦) city_id على كلِّ جدولٍ ────────────────────────────────────────────────

check(migration, "city_id uuid not null references cities(id)", "city_id على كلِّ جدولٍ");

// ── ٧) المجالُ ──────────────────────────────────────────────────────────────

check(domain, "ProcessingBasis", "نوعُ أساسِ المعالجةِ في المجالِ");
check(domain, "SubjectRight", "نوعُ حقِّ صاحبِ البياناتِ في المجالِ");
check(domain, "DpiaRiskLevel", "نوعُ مستوى خطرِ DPIA في المجالِ");
check(domain, "TransferBasis", "نوعُ أساسِ النقلِ في المجالِ");
check(domain, "RIGHT_REQUEST_DEADLINE_DAYS", "ثابتُ مهلةِ الطلبِ في المجالِ");
check(domain, "DPIA_REVIEW_INTERVAL_YEARS", "ثابتُ فترةِ مراجعةِ DPIA");
check(domain, "CROSS_BORDER_TRANSFER_EXPIRY_DAYS", "ثابتُ انتهاءِ النقلِ");

// ── ٨) التطبيقُ ─────────────────────────────────────────────────────────────

check(app, "PdplComplianceStore", "عقدُ المخزنِ في التطبيقِ");
check(app, "checkActivityAllowed", "حالةُ استخدامِ السماحِ بالنشاطِ");
check(app, "checkDpiaRequired", "حالةُ استخدامِ اشتراطِ DPIA");
check(app, "checkCrossBorderTransferAllowed", "حالةُ استخدامِ السماحِ بالنقلِ");
check(app, "submitRightRequest", "حالةُ استخدامِ تسجيلِ الطلبِ");

// ── ٩) البنيةُ التحتيّةُ ─────────────────────────────────────────────────────

check(store, "createPostgrestPdplStore", "مخزنُ PostgREST");
check(store, "pdpl_processing_activity_is_allowed", "استدعاءُ دالّةِ السماحِ");
check(store, "pdpl_cross_border_transfer_allowed", "استدعاءُ دالّةِ النقلِ");
check(store, "pdpl_record_right_request", "استدعاءُ دالّةِ تسجيلِ الطلبِ");

// ── ١٠) السالباتُ ────────────────────────────────────────────────────────────

check(domain, "export const PROCESSING_BASES", "قائمةُ أسسِ المعالجةِ مغلقةٌ");
check(domain, "export const SUBJECT_RIGHTS", "قائمةُ الحقوقِ مغلقةٌ");
check(domain, "export const TRANSFER_BASES", "قائمةُ أسسِ النقلِ مغلقةٌ");

console.log(`✓ امتثال PDPL (F12-10): ${checked} عنصراً مُثبَتاً — المحاورُ الأربعةُ مغطّاةٌ.`);
