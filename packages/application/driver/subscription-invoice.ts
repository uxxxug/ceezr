/**
 * الغرض: حالاتُ استخدامِ الفاتورةِ الضريبيّةِ وحالِ العمليةِ — إصدارٌ بعدَ نجاحِ
 *   دفعٍ، وقراءةُ فاتورةٍ، وقراءةُ حالِ معاملةٍ (`F3-09` · `SD-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-09`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `apps/gateway/src/routes/driver-subscription-invoice.ts`
 * يُتوقع أن يستخدمه لاحقاً: سطحُ الفاتورةِ في التطبيقِ المُصغَّرِ (الدفعةُ
 *   الثانيةُ) — يستدعي هذه الحالاتَ نفسَها لا مساراً موازياً.
 * يحرسُه: scripts/check-tax-invoice-contract.ts ·
 *   tests/unit/subscription-invoice.test.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * ## لِمَ معرِّفُ المعاملةِ يُفحَصُ شكلُه ههنا
 *
 * لأنَّ نصّاً ليسَ `UUID` يُمرَّرُ إلى القاعدةِ **يرفعُ استثناءً** فيُقرأُ عطبَ
 * مخزنٍ فيُجابُ `503` — أي «الخدمةُ معطَّلةٌ» جواباً عن طلبٍ مُشوَّهٍ. وذاكَ يُخفي
 * خطأَ عميلٍ في زيِّ عطبِ خادمٍ، **ويُلوِّثُ قياسَ الأعطالِ** فيصيرُ لكلِّ فحصٍ
 * صحّةٍ ضجيجٌ من طلباتٍ خاطئةٍ. فالشكلُ يُفحَصُ قبلَ القاعدةِ، والجوابُ `422`.
 *
 * ## ولِمَ الإصدارُ `POST` والقراءةُ `GET` — بلا كتابةٍ في `GET` ألبتّةَ
 *
 * لأنَّ `GET` يُعادُ تلقائيّاً: مُتصفِّحٌ يُحدِّثُ، ووسيطٌ يُخبِّئُ، وشاشةٌ تُعادُ
 * تركيبَها. ولو أصدرَ `GET` فاتورةً لَصارَ **الترقيمُ المتتابعُ رهنَ زرِّ تحديثٍ**.
 * والتماثلُ في القاعدةِ يمنعُ الرقمَ الثانيَ، لكنَّ منعَ الكتابةِ في `GET` **حدٌّ
 * في العقدِ لا في التنفيذِ** — فلا يُنقَضُ بتغييرِ دالّةٍ.
 *
 * ## وما لا تفعلُه هذه الحالاتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تحسبُ ضريبةً ولا تبني رمزَ استجابةٍ**: القاعدةُ تحسبُ وتبني،
 *      والطبقةُ تنقلُ. ولو حسبَت لَصارَ للإقرارِ حاسبانِ.
 *   ــ **لا تقرأُ معرِّفَ سائقٍ من طلبٍ**: من الجلسةِ وحدَها.
 *   ــ **لا تُحصِّلُ مالاً ولا تُغيِّرُ حالَ معاملةٍ**: التحصيلُ عندَ المزوّدِ،
 *      والحالُ من الويبهوكِ.
 *   ــ **لا تُصدِرُ لمعاملةٍ غيرِ ناجحةٍ**: `TRANSACTION_NOT_PAID` مُعلَنٌ لا
 *      مُتجاوَزٌ.
 *   ــ **لا تُشعِرُ أحداً**: الإصدارُ ليسَ إبلاغاً.
 */

import type {
  SimplifiedTaxInvoice,
  SubscriptionPaymentStatus,
} from "../../domain/driver/subscription-invoice.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import {
  isTaxInvoiceRejection,
  type SubscriptionTaxInvoiceStore,
  type TaxInvoiceIssueOutcome,
  type TaxInvoiceStoreError,
} from "./subscription-invoice-ports.ts";

/** رموزُ العطبِ المنشورةُ — قائمةٌ تُقرأُ في زمنِ التشغيلِ ليُلزِمَ الحاجزُ نصّاً لكلٍّ. */
export const TAX_INVOICE_PUBLIC_ERROR_CODES = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "INVOICE_STORE_NOT_AVAILABLE",
  "NOT_A_DRIVER",
  "TRANSACTION_ID_INVALID",
  "TRANSACTION_NOT_FOUND",
  "TRANSACTION_NOT_PAID",
  "TAX_IDENTITY_NOT_CONFIGURED",
  "INVOICE_WITHOUT_TAX_FIELDS",
  "INVOICE_NOT_ISSUED",
] as const;

export type TaxInvoicePublicErrorCode = (typeof TAX_INVOICE_PUBLIC_ERROR_CODES)[number];

export interface TaxInvoiceRejection {
  readonly code: TaxInvoicePublicErrorCode;
}

export interface SubscriptionInvoiceDeps {
  readonly sessions: MiniAppSessionReader;
  readonly store: SubscriptionTaxInvoiceStore;
  readonly now: () => Date;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rejection(code: TaxInvoicePublicErrorCode): TaxInvoiceRejection {
  return { code };
}

function sessionErrorFrom(reason: string): TaxInvoicePublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

async function openSession(
  deps: SubscriptionInvoiceDeps,
  accessToken: string | undefined,
): Promise<Result<string, TaxInvoiceRejection>> {
  if (accessToken === undefined || accessToken.length === 0) {
    return err(rejection("SESSION_REQUIRED"));
  }
  const session = await deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(rejection(sessionErrorFrom(session.error.reason)));
  return ok(session.value.telegramUserId);
}

/**
 * معرِّفُ المعاملةِ من طلبٍ. **يُرفَضُ ولا يُقصَرُ** — بخلافِ سقفِ صفحةٍ: رقمٌ
 * خرافيٌّ في سقفٍ يُقرأُ افتراضاً، ومعرِّفٌ مُشوَّهٌ لا افتراضَ له إذ لا وثيقةَ
 * افتراضيّةً.
 */
export function parseTransactionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

/**
 * **شاملةٌ حرفاً** لاتّحادِ رفضِ المخزنِ: زيادةُ رمزٍ في المنفذِ بلا سطرٍ ههنا
 * تُخفِقُ في الترجمةِ لا في زمنِ التشغيلِ.
 */
function publicCodeFrom(error: TaxInvoiceStoreError): TaxInvoiceRejection {
  if (!isTaxInvoiceRejection(error)) return rejection("INVOICE_STORE_NOT_AVAILABLE");
  switch (error.rejection) {
    case "USER_NOT_FOUND":
    case "NOT_A_DRIVER":
      return rejection("NOT_A_DRIVER");
    case "TRANSACTION_NOT_FOUND":
      return rejection("TRANSACTION_NOT_FOUND");
    case "TRANSACTION_NOT_PAID":
      return rejection("TRANSACTION_NOT_PAID");
    // نقصُ هويّةِ البائعِ ونقصُ النسبةِ **عطبُ تهيئةٍ واحدٌ في عينِ السائقِ**:
    // كلاهما «لا أستطيعُ إصدارَ وثيقةٍ صحيحةٍ الآنَ»، ولا يملكُ هوَ إصلاحَ فرقٍ
    // بينَهما. والتفريقُ مُسجَّلٌ في السجلِّ للمشغِّلِ لا في الجوابِ للسائقِ.
    case "TAX_IDENTITY_NOT_CONFIGURED":
    case "VAT_RATE_NOT_CONFIGURED":
      return rejection("TAX_IDENTITY_NOT_CONFIGURED");
    // **صفٌّ صدرَ قبلَ أعمدةِ الضريبةِ**: ليسَ غياباً (فالصفُّ موجودٌ) ولا عطبَ
    // تهيئةٍ (فالتهيئةُ قد تكونُ تامّةً اليومَ)، بل **حالُ موردٍ**: وثيقةٌ ثابتةٌ
    // لا يُمكِنُ ترقيتُها. فرمزٌ مستقلٌّ بحالةِ ٤٠٩ — ولا يُدَّعى أنَّها فاتورةٌ
    // ضريبيّةٌ بخاناتٍ فارغةٍ.
    case "INVOICE_WITHOUT_TAX_FIELDS":
      return rejection("INVOICE_WITHOUT_TAX_FIELDS");
    // **عطبُ بياناتٍ داخليٌّ**: خطّةُ الاشتراكِ غائبةٌ من المعاملةِ، ولا يفعلُ
    // السائقُ به شيئاً ولا يُفصَحُ له عن بنيةِ بياناتِنا. فيُقرأُ عندَه عطبَ
    // مخزنٍ (٥٠٣) ويبقى مُفرَّقاً في السجلِّ للمشغِّلِ.
    case "PAYMENT_PLAN_MISSING":
      return rejection("INVOICE_STORE_NOT_AVAILABLE");
    case "INVOICE_NOT_ISSUED":
      return rejection("INVOICE_NOT_ISSUED");
  }
}

export async function issueSubscriptionTaxInvoice(
  deps: SubscriptionInvoiceDeps,
  input: { readonly accessToken: string | undefined; readonly transactionId: unknown },
): Promise<Result<TaxInvoiceIssueOutcome, TaxInvoiceRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const transactionId = parseTransactionId(input.transactionId);
  if (transactionId === null) return err(rejection("TRANSACTION_ID_INVALID"));

  const issued = await deps.store.issueInvoice({
    telegramUserId: session.value,
    transactionId,
  });
  if (!issued.ok) return err(publicCodeFrom(issued.error));
  return ok(issued.value);
}

export async function readSubscriptionTaxInvoice(
  deps: SubscriptionInvoiceDeps,
  input: { readonly accessToken: string | undefined; readonly transactionId: unknown },
): Promise<Result<SimplifiedTaxInvoice, TaxInvoiceRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const transactionId = parseTransactionId(input.transactionId);
  if (transactionId === null) return err(rejection("TRANSACTION_ID_INVALID"));

  const read = await deps.store.readInvoice({
    telegramUserId: session.value,
    transactionId,
  });
  if (!read.ok) return err(publicCodeFrom(read.error));
  return ok(read.value);
}

export async function readSubscriptionPaymentStatus(
  deps: SubscriptionInvoiceDeps,
  input: { readonly accessToken: string | undefined; readonly transactionId: unknown },
): Promise<Result<SubscriptionPaymentStatus, TaxInvoiceRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const transactionId = parseTransactionId(input.transactionId);
  if (transactionId === null) return err(rejection("TRANSACTION_ID_INVALID"));

  const read = await deps.store.readPaymentStatus({
    telegramUserId: session.value,
    transactionId,
  });
  if (!read.ok) return err(publicCodeFrom(read.error));
  return ok(read.value);
}
