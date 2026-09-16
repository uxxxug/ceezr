/**
 * الغرض: محوّلُ حقَّي البيانةِ على PostgreSQL — نداءُ `export_my_data` ونداءُ
 *   `erase_my_account`، وقراءةُ حمولتِهما **بلا افتراضٍ** (`F2-11`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-11`.
 * ينتمي إلى: infrastructure/privacy
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: `SD-12` — الدالّتانِ تُعمَّمانِ على الدورِ في
 *   القاعدةِ، ولا يُكتَبُ محوّلٌ ثانٍ.
 * الحاكم: docs/adr/0112-erasure-is-a-per-table-judgement-not-a-delete.md
 *
 * ## لماذا **المنطقُ في القاعدةِ** لا ههنا
 *
 * المحوُ يمسُّ أحدَ عشرَ جدولاً بأحكامٍ مختلفةٍ. ولو نُفِّذَ بأحدَ عشرَ نداءً من
 * هذه الطبقةِ لَكانَ انقطاعُ الشبكةِ في السادسِ يتركُ إنساناً **نصفَ محذوفٍ**:
 * أماكنُه ذهبَت واسمُه باقٍ، ولا صفحةَ تُخبرُه أيَّهما وقعَ. فالكلُّ في معاملةٍ
 * واحدةٍ في القاعدةِ: إمّا أن يقعَ كلُّه أو لا يقعَ منه شيءٌ. وهذا ليسَ تفضيلاً
 * أسلوبيّاً بل **الشرطُ الوحيدُ** لأن يكونَ الإيصالُ صادقاً.
 *
 * ## ولماذا حمولةٌ لا تُفهَمُ **تُعلَنُ عطباً** ولا تُقرأُ نجاحاً
 *
 * إيصالٌ ناقصُ الحقولِ يُقرأُ «مُحيَ كلُّ شيءٍ» أخطرُ من عطلٍ ظاهرٍ: الإنسانُ
 * يمضي مطمئنّاً إلى وعدٍ لم يُقَسْ. فرمزُ أساسٍ خارجَ المجالِ المغلقِ، أو عددٌ
 * ليسَ صحيحاً غيرَ سالبٍ، أو قسمُ إبقاءٍ بلا أساسٍ — كلُّها `MALFORMED_RESULT`.
 */

import type {
  DataRightsStore,
  DataRightsStoreFailure,
  ExportVerdict,
} from "../../application/privacy/ports.ts";
import {
  type DataExportBundle,
  type ErasureOutcome,
  type ErasureReceipt,
  isErasureRefusal,
  isExportRefusal,
  isRetentionBasis,
  type RetainedSection,
} from "../../domain/privacy/data-rights.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

function failed(reason: DataRightsStoreFailure["reason"]): DataRightsStoreFailure {
  return { reason };
}

/** كما في `sos-surface-store.ts`: لا نصَّ غيرَ رقميٍّ يُرسَلُ إلى `bigint`. */
function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readCount(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * مبلغٌ **بإشارتِه**: `readCount` يردُّ السالبَ لأنَّ عدَّ صفوفٍ لا يسلُبُ، وهذا
 * رصيدُ محفظةٍ **قد يكونُ سالباً** (سائقٌ عليه لا له). ولو قُرِئَ بـ`readCount`
 * لَصارَ الرصيدُ السالبُ `MALFORMED_RESULT`، فيُقالُ للإنسانِ «عطبٌ» والقاعدةُ
 * قالت رقماً صحيحاً — وذاكَ إخفاءُ دَينٍ بعُطلٍ مُختلَقٍ.
 */
function readSignedAmount(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) ? parsed : null;
}

/** وقتٌ يُعادُ من `jsonb` قد يكونُ نصّاً أو `Date` حسبَ المُسلسِلِ. */
function readInstant(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  const text = readText(value);
  if (text === null) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readCountMap(value: unknown): Readonly<Record<string, number>> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const count = readCount(raw);
    if (count === null) return null;
    out[key] = count;
  }
  return out;
}

function readRetained(value: unknown): readonly RetainedSection[] | null {
  if (!Array.isArray(value)) return null;
  const out: RetainedSection[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const section = readText(entry.section);
    const rows = readCount(entry.rows);
    const basis = entry.basis;
    if (section === null || rows === null || !isRetentionBasis(basis)) return null;
    out.push({ section, rows, basis });
  }
  // إيصالٌ بلا سطرِ إبقاءٍ واحدٍ يعني حمولةً من نسخةٍ أخرى: سجلُّ التدقيقِ
  // **يبقى دائماً** لأنَّه إثباتُ هذا الحذفِ نفسِه.
  return out.length === 0 ? null : out;
}

function readReceipt(value: unknown): ErasureReceipt | null {
  if (!isRecord(value)) return null;
  const erased = readCountMap(value.erased);
  const anonymized = readCountMap(value.anonymized);
  const retained = readRetained(value.retained);
  if (erased === null || anonymized === null || retained === null) return null;
  return { erased, anonymized, retained };
}

interface ResultRow {
  readonly result: unknown;
}

export class PostgresDataRightsStore implements DataRightsStore {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async exportMyData(input: {
    readonly telegramUserId: string;
  }): Promise<Result<ExportVerdict, DataRightsStoreFailure>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return ok({ exported: false, refusal: "INVALID_ACTOR" });

    let rows: readonly ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`select export_my_data(${telegramId}::bigint) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));

    if (payload.ok !== true) {
      const refusal = payload.reason;
      if (!isExportRefusal(refusal)) return err(failed("MALFORMED_RESULT"));
      return ok({ exported: false, refusal });
    }

    // **`generated_at` لا `exported_at`**: هوَ المفتاحُ الذي تُصدِرُه الدالّةُ
    // المُطبَّقةُ فعلاً في `20260914180000`. والهجرةُ المُطبَّقةُ لا تُحرَّرُ
    // بأثرٍ رجعيٍّ، فالمحوّلُ هوَ الذي يُطابِقُ الواقعَ لا العكسُ. وكُشِفَ هذا
    // الاختلافُ باختبارِ تكاملٍ على قاعدةٍ حقيقيّةٍ، لا بمراجعةِ نظرٍ.
    const exportedAt = readInstant(payload.generated_at);
    const subject = readText(payload.subject);
    const sections = payload.sections;
    if (exportedAt === null || subject === null || !isRecord(sections)) {
      return err(failed("MALFORMED_RESULT"));
    }
    const bundle: DataExportBundle = { exportedAt, subject, sections };
    return ok({ exported: true, bundle });
  }

  async eraseMyAccount(input: {
    readonly telegramUserId: string;
  }): Promise<Result<ErasureOutcome, DataRightsStoreFailure>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) {
      return ok({
        erased: false,
        refusal: "INVALID_ACTOR",
        activeOrders: 0,
        walletBalanceMinor: 0,
      });
    }

    let rows: readonly ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`select erase_my_account(${telegramId}::bigint) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));

    if (payload.ok !== true) {
      const refusal = payload.reason;
      if (!isErasureRefusal(refusal)) return err(failed("MALFORMED_RESULT"));
      // `active_orders` **يُقرأُ ولا يُفترَضُ**: الشاشةُ تقولُ للإنسانِ كم
      // رحلةً تمنعُه، وصفرٌ مُفترَضٌ يجعلُها تقولُ «لا شيءَ يمنعُكَ» ثمَّ ترفضُ.
      const activeOrders = refusal === "ACTIVE_ORDER" ? readCount(payload.active_orders) : 0;
      if (activeOrders === null) return err(failed("MALFORMED_RESULT"));
      // `balance_minor` كذلكَ **يُقرأُ ولا يُفترَضُ** (`SD-12`): «لا يمكنُ حذفُ
      // حسابِكَ لأنَّ فيه رصيداً» بلا رقمٍ تدفعُ الإنسانَ إلى دعمٍ ليسألَ **كم**،
      // وصفرٌ مُفترَضٌ ههنا يجعلُ الشاشةَ تقولُ «رصيدُكَ ٠٫٠٠» ثمَّ تمنعُه به.
      const walletBalanceMinor =
        refusal === "WALLET_HAS_BALANCE" ? readSignedAmount(payload.wallet_balance_minor) : 0;
      if (walletBalanceMinor === null) return err(failed("MALFORMED_RESULT"));
      return ok({ erased: false, refusal, activeOrders, walletBalanceMinor });
    }

    const erasedAt = readInstant(payload.erased_at);
    if (erasedAt === null) return err(failed("MALFORMED_RESULT"));

    // `ALREADY_ERASED` يُعادُ **بلا إيصالٍ**: الإيصالُ وثيقةُ لحظةِ الوقوعِ،
    // وإعادةُ بنائِه بعدَ حينٍ اختلاقٌ لأعدادٍ لم تُقَسْ في تلكَ اللحظةِ.
    if (payload.reason === "ALREADY_ERASED") return ok({ erased: true, erasedAt, receipt: null });

    const receipt = readReceipt(payload.receipt);
    if (receipt === null) return err(failed("MALFORMED_RESULT"));
    return ok({ erased: true, erasedAt, receipt });
  }
}
