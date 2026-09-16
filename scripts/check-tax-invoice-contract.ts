#!/usr/bin/env bun
/**
 * الغرض: تشغيلُ قواعدِ عقدِ الفاتورةِ الضريبيّةِ المبسَّطةِ على المستودعِ الحقيقيِّ
 *   وإسقاطُ البناءِ عندَ نقضِ واحدةٍ (`F3-09` · `SD-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-09`.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run check:tax-invoice` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * يُتوقع أن يستخدمه لاحقاً: أيُّ وثيقةٍ ضريبيّةٍ ثانيةٍ (إشعارُ دائنٍ) — تُزادُ في
 *   `SCOPE_FILES` ولا يُكتَبُ حاجزٌ ثانٍ للسؤالِ نفسِه.
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * ولماذا القراءةُ ههنا والحكمُ في `lib`: كي يُقاسَ الحكمُ بمدخلاتٍ مصنوعةٍ —
 * والقاعدةُ التي لا حالةَ سلبيّةَ لها **غيرُ مُنفَذةٍ** (`ح-7`).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TAX_INVOICE_PUBLIC_ERROR_CODES } from "../packages/application/driver/subscription-invoice.ts";
import { TAX_INVOICE_STORE_REJECTIONS } from "../packages/application/driver/subscription-invoice-ports.ts";
import { blankComments } from "./lib/blank-comments.ts";
import {
  type TaxInvoiceContractInput,
  taxInvoiceContractProblems,
} from "./lib/tax-invoice-contract.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const INVOICE_MIGRATION = `${MIGRATIONS_DIR}/20260916050000_f3_09_subscription_tax_invoice.sql`;
const ROUTE_FILE = "apps/gateway/src/routes/driver-subscription-invoice.ts";

/**
 * مِلفّاتُ سطحِ التطبيقِ المُصغَّرِ — القواعدُ ٩ و١٠ و١٢. والتعليقاتُ **لا تُبيَّضُ**
 * ههنا… بل تُبيَّضُ: شرحُ «لا نقيسُ `paid`» ليسَ قياساً لـ`paid`.
 */
const SURFACE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/driver/subscription/invoice-contract.ts",
  "apps/miniapp/src/surfaces/driver/subscription/invoice-api.ts",
  "apps/miniapp/src/surfaces/driver/subscription/invoice-view.ts",
  "apps/miniapp/src/surfaces/driver/subscription/PaymentInvoicePanel.tsx",
];

/** لغاتُ التطبيقِ المُصغَّرِ الثلاثُ — القاعدةُ ١١. */
const I18N_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

/** مِلفّاتُ نطاقِ الفاتورةِ — الطبقاتُ الأربعُ ولا شيءَ سواها. */
const SCOPE_FILES: readonly string[] = [
  "packages/domain/driver/subscription-invoice.ts",
  "packages/application/driver/subscription-invoice-ports.ts",
  "packages/application/driver/subscription-invoice.ts",
  "packages/infrastructure/driver/subscription-invoice-store.ts",
  ROUTE_FILE,
];

export function readRepository(): TaxInvoiceContractInput {
  const allMigrations: Record<string, string> = {};
  for (const entry of readdirSync(MIGRATIONS_DIR)) {
    if (!entry.endsWith(".sql")) continue;
    const path = join(MIGRATIONS_DIR, entry);
    allMigrations[path] = readFileSync(path, "utf8");
  }

  const scopeFiles: Record<string, string> = {};
  for (const path of SCOPE_FILES) {
    // التعليقاتُ تُبيَّضُ: شرحُ «لا نحملُ `cvv`» ليسَ حملاً لـ`cvv`.
    scopeFiles[path] = blankComments(readFileSync(path, "utf8"));
  }

  const surfaceFiles: Record<string, string> = {};
  for (const path of SURFACE_FILES) {
    surfaceFiles[path] = blankComments(readFileSync(path, "utf8"));
  }

  const i18nFiles: Record<string, Record<string, string>> = {};
  for (const [lang, path] of Object.entries(I18N_FILES)) {
    i18nFiles[lang] = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  }

  return {
    invoiceMigration: readFileSync(INVOICE_MIGRATION, "utf8"),
    allMigrations,
    scopeFiles,
    routeFile: scopeFiles[ROUTE_FILE] ?? "",
    storeRejections: TAX_INVOICE_STORE_REJECTIONS,
    publicErrorCodes: TAX_INVOICE_PUBLIC_ERROR_CODES,
    surfaceFiles,
    i18nFiles,
  };
}

if (import.meta.main) {
  const input = readRepository();
  const problems = taxInvoiceContractProblems(input);
  if (problems.length === 0) {
    console.log(
      `حاجزُ عقدِ الفاتورةِ الضريبيّةِ: نجحَ — ${Object.keys(input.allMigrations).length} هجرةً ` +
        `مقروءةً، و${SCOPE_FILES.length} مِلفَّ نطاقٍ، و${input.storeRejections.length} رمزَ رفضٍ ` +
        `مُتكافئاً مع دوالِّ القاعدةِ، و${input.publicErrorCodes.length} رمزاً عامّاً بحالةِ HTTP، ` +
        `و${SURFACE_FILES.length} مِلفَّ سطحٍ، و${Object.keys(input.i18nFiles).length} لغةً، ` +
        `واثنتَي عشرةَ قاعدةً مقيسةً: لا مُفردةَ بطاقةٍ، ولا تحديثَ ولا حذفَ لفاتورةٍ، ` +
        `ولا إصدارَ في «GET»، وتكافؤُ اتّحادِ الرفضِ، وشمولُ خريطةِ الحالاتِ، ` +
        `والضريبةُ مستخرَجةٌ من مبلغٍ شاملٍ، ولا هويّةَ ضريبيّةً مزروعةً، ولا معرِّفَ مزوِّدٍ مكشوفاً، ` +
        `ولا حالَ سدادٍ مقيسٌ في سطحٍ، ولا ترميزَ حِمْلٍ فيه، وتكافؤُ نصوصِ الأعطابِ، ولا حسابَ ضريبةٍ.`,
    );
  } else {
    console.error("حاجزُ عقدِ الفاتورةِ الضريبيّةِ: سقطَ.");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
