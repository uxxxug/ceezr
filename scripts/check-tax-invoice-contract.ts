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

  return {
    invoiceMigration: readFileSync(INVOICE_MIGRATION, "utf8"),
    allMigrations,
    scopeFiles,
    routeFile: scopeFiles[ROUTE_FILE] ?? "",
    storeRejections: TAX_INVOICE_STORE_REJECTIONS,
    publicErrorCodes: TAX_INVOICE_PUBLIC_ERROR_CODES,
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
        `وثمانِ قواعدَ مقيسةً: لا مُفردةَ بطاقةٍ، ولا تحديثَ ولا حذفَ لفاتورةٍ، ` +
        `ولا إصدارَ في «GET»، وتكافؤُ اتّحادِ الرفضِ، وشمولُ خريطةِ الحالاتِ، ` +
        `والضريبةُ مستخرَجةٌ من مبلغٍ شاملٍ، ولا هويّةَ ضريبيّةً مزروعةً، ولا معرِّفَ مزوِّدٍ مكشوفاً.`,
    );
  } else {
    console.error("حاجزُ عقدِ الفاتورةِ الضريبيّةِ: سقطَ.");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
