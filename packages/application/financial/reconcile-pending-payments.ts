/**
 * الغرض: مراجعة الدفعات المعلّقة من خادم المزوّد وحسمها — إغلاق ثقب «دفع السائق
 *   ولم يُفعَّل اشتراكه» حين يضيع الويبهوك.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: application/financial
 * يُتوقع أن يستخدمه لاحقاً: apps/workers (مهمّة reconcile-pending-payments)
 * ملاحظات مستقبلية: الحدّان الزمنيان وسقف الدفعة من `platform_settings` لا من الكود.
 *
 * ## لماذا هذه الحالة موجودة
 *
 * الويبهوك مسار الحسم الأساسي، لكنّه مسارٌ لا نملكه: انقطاعٌ عند المزوّد، أو
 * إعادة نشرٍ عندنا في اللحظة الخطأ، أو 503 عابر — وتضيع الرسالة. وقتها يبقى
 * الصفّ `pending` إلى الأبد، والسائق قد دفع فعلاً. فهذه الحالة هي المسار الثاني:
 * نسأل خادم المزوّد نحن، بدلاً من انتظار أن يخبرنا.
 *
 * ## حدّ التغطية — إفصاحٌ لا تجميل
 *
 * المراجعة تعمل على الصفوف التي تحمل `provider_transaction_id` فقط، لأنّ هذا هو
 * ما يُسأل به المزوّد. وهذا يعني تغطيةً غير متساوية بين المزوّدين:
 *
 * - Tap يعيد `charge.id` لحظةَ الشحن، فيُحفظ فوراً، فكلّ دفعات Tap مغطّاة.
 * - Moyasar في مسار الفاتورة المستضافة لا يعيد معرّف دفعةٍ أصلاً (يعيد فاتورةً؛
 *   معرّف الدفعة لا يُولَد إلا حين يدفع العميل). فصفوفه تبقى بمرجعٍ فارغ ولا
 *   تُدرَج في المراجعة. وكتابةُ معرّف الفاتورة مكانه ليست حلاً بل تخريب: مطابقة
 *   `confirm_webhook_payment` تقارن معرّف الدفعة، فيصير كلّ ويبهوكٍ حقيقيّ
 *   `PROVIDER_TRANSACTION_MISMATCH` — أي أنّنا نكسر المسار الأول لنُرقّع الثاني.
 *
 * المزوّد المفعّل الآن هو Tap، فالثقب مغلقٌ للمسار العامل. وتغطية Moyasar تحتاج
 * ربطاً بمعرّف الفاتورة في طرف المزوّد (بحث بالفاتورة لا بالدفعة)، وهو عملٌ
 * مستقلّ لا يُدّعى أنّه منجَز هنا.
 *
 * ## ما لا تفعله هذه الحالة
 *
 * لا تثق بشيء تقوله اللقطة إلا بعد مطابقته بالصفّ المقفل. المزوّد يعيد مبلغاً
 * وعملةً ومعرّفاً — وثلاثتها تُقارن، ثم يُترك القرار كلّه لـ`confirmWebhookPayment`
 * الذي يقفل الصفّ ويعيد التحقّق ذرّياً ويكتب دفتر الأستاذ ويُفعّل الاشتراك في
 * معاملةٍ واحدة. فما تفعله هذه الحالة هو السؤال والمطابقة، لا الكتابة.
 *
 * ومعرّف الحدث `reconcile:{provider}:{providerTransactionId}:{status}` يجعل
 * المراجعة نفسها إيدمبوتنسية: تشغيلها مرّتين لا يُفعّل اشتراكاً مرّتين ولا يكتب
 * قيدين، لأنّ `webhook_events` يرفض المعرّف المكرّر داخل القفل.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import type { PaymentProvider, PaymentRepository, StalePendingPayment } from "./ports.ts";

/** يُرفع عند فشلٍ يمنع المراجعة كلّها لا دفعةً واحدة. */
export class ReconcilePendingPaymentsError extends Error {
  readonly code = "RECONCILE_PENDING_PAYMENTS_FAILED";
  constructor(readonly detail: string) {
    super(`تعذّرت مراجعة الدفعات المعلّقة: ${detail}`);
    this.name = "ReconcilePendingPaymentsError";
  }
}

export interface ReconcilePendingPaymentsDeps {
  readonly payments: PaymentRepository;
  readonly provider: PaymentProvider;
  /** يُستدعى لكل دفعةٍ حُسمت أو رُفضت — للرصد لا للتحكم. */
  readonly log?: (event: string, fields: Readonly<Record<string, unknown>>) => void;
}

export interface ReconcilePendingPaymentsInput {
  /** المراجعة بنطاق مدينة: الحدّان يُقرآن من إعدادات المدينة لا من إعدادٍ عام. */
  readonly cityId: string;
  /** لا تُراجَع دفعةٌ لم يمضِ عليها هذا القدر: قد يكون السائق في صفحة الدفع الآن. */
  readonly olderThanSeconds: number;
  /** لا تُراجَع دفعةٌ تجاوزت هذا العمر: رابطها انتهى عند المزوّد ولن تتغيّر. */
  readonly maxAgeSeconds: number;
  /** سقف الدفعة الواحدة — يحمي حدّ استدعاءات المزوّد. */
  readonly limit: number;
}

export interface ReconcilePendingPaymentsOutcome {
  /** عدد الصفوف التي رشّحتها القاعدة للمراجعة. */
  readonly examined: number;
  /** عدد الدفعات التي حُسمت فعلاً إلى حالة نهائية في هذه الدفعة. */
  readonly settled: number;
  /** ما زال المزوّد يقول عنها `pending` — تُترك للدورة القادمة. */
  readonly stillPending: number;
  /** حُسمت سابقاً بويبهوكٍ وصل بيننا وبين السؤال، أو بدورةٍ سابقة. */
  readonly alreadySettled: number;
  /** فشل السؤال أو المطابقة — مرصودةٌ ولا تُسقط بقيّة الدفعة. */
  readonly failed: number;
}

/**
 * يسأل خادم المزوّد عن كل دفعةٍ معلّقة مرشّحة، ويحسم ما صار نهائياً عنده.
 *
 * فشلُ دفعةٍ واحدة لا يُسقط الدورة: دفعةٌ واحدة عالقة عند المزوّد لا يجوز أن
 * تمنع حسم البقيّة. والفشل الذي يُسقط الدورة هو تعذّر السرد نفسه وحده.
 */
export async function reconcilePendingPayments(
  input: ReconcilePendingPaymentsInput,
  deps: ReconcilePendingPaymentsDeps,
): Promise<Result<ReconcilePendingPaymentsOutcome, ReconcilePendingPaymentsError>> {
  if (deps.payments.confirmWebhookPayment === undefined) {
    // المسار الذرّي هو الوحيد الذي يطابق المبلغ والعملة داخل القفل. وبدونه تصير
    // المراجعة تفعيلاً على كلام المزوّد بلا مطابقة — وهذا أخطر من ألّا تُراجَع.
    return err(
      new ReconcilePendingPaymentsError("PAYMENT_REPOSITORY_DOES_NOT_SUPPORT_VERIFIED_WEBHOOKS"),
    );
  }
  const confirm = deps.payments.confirmWebhookPayment.bind(deps.payments);

  const stale = await deps.payments.findStalePending({
    cityId: input.cityId,
    olderThanSeconds: input.olderThanSeconds,
    maxAgeSeconds: input.maxAgeSeconds,
    limit: input.limit,
  });
  if (!stale.ok) {
    return err(new ReconcilePendingPaymentsError(stale.error.detail));
  }

  const log = deps.log ?? (() => {});
  let settled = 0;
  let stillPending = 0;
  let alreadySettled = 0;
  let failed = 0;

  for (const row of stale.value) {
    // مزوّدٌ لا يملك الصفّ لا يُسأل عنه: تغيّر المزوّد المُهيّأ بعد إنشاء المعاملة
    // مسارٌ واقعي، وسؤالُ المزوّد الجديد عن معرّفٍ ليس له يعيد صفّاً غريباً.
    if (row.provider !== deps.provider.name) {
      log("payment.reconcile.provider_skipped", {
        transactionId: row.id,
        rowProvider: row.provider,
        activeProvider: deps.provider.name,
      });
      continue;
    }

    const snapshot = await deps.provider.fetchTransaction(row.providerTransactionId);
    if (!snapshot.ok) {
      failed += 1;
      log("payment.reconcile.fetch_failed", {
        transactionId: row.id,
        detail: snapshot.error.detail,
      });
      continue;
    }

    const mismatch = describeMismatch(row, snapshot.value);
    if (mismatch !== null) {
      // لا تُحسَم دفعةٌ لا تُطابق صفّها. هذا ليس عطلاً عابراً يُعاد المحاولة عليه،
      // بل تناقضٌ يحتاج بشراً — فيُرصد صريحاً ولا يُخفى في عدّاد «معلّقة».
      failed += 1;
      log("payment.reconcile.mismatch", { transactionId: row.id, reason: mismatch });
      continue;
    }

    if (snapshot.value.status === "pending") {
      stillPending += 1;
      continue;
    }

    const confirmed = await confirm({
      transactionId: row.id,
      providerTransactionId: snapshot.value.id,
      newStatus: snapshot.value.status,
      providerAmount: snapshot.value.amount,
      providerCurrency: snapshot.value.currency,
      provider: deps.provider.name,
      webhookEventId: reconciliationEventId(
        deps.provider.name,
        snapshot.value.id,
        snapshot.value.status,
      ),
      rawPayload: JSON.stringify({
        source: "reconciliation",
        providerTransactionId: snapshot.value.id,
        status: snapshot.value.status,
      }),
    });
    if (!confirmed.ok) {
      // السباق مع ويبهوكٍ وصل في هذه اللحظة نتيجةٌ صحيحة لا فشل: الصفّ صار
      // نهائياً، وهو بعينه ما كنا نريد.
      if (confirmed.error.detail.includes("INVALID_STATUS_TRANSITION")) {
        alreadySettled += 1;
        continue;
      }
      failed += 1;
      log("payment.reconcile.confirm_failed", {
        transactionId: row.id,
        detail: confirmed.error.detail,
      });
      continue;
    }
    if (confirmed.value.duplicate) {
      alreadySettled += 1;
      continue;
    }
    settled += 1;
    log("payment.reconcile.settled", {
      transactionId: row.id,
      status: snapshot.value.status,
    });
  }

  return ok({
    examined: stale.value.length,
    settled,
    stillPending,
    alreadySettled,
    failed,
  });
}

/**
 * يبني معرّف حدثٍ ثابتاً للمراجعة، فيصير تكرار الدورة تكراراً معروفاً عند
 * `webhook_events` لا تفعيلاً ثانياً.
 */
export function reconciliationEventId(
  provider: string,
  providerTransactionId: string,
  status: string,
): string {
  return `reconcile:${provider}:${providerTransactionId}:${status}`;
}

/**
 * يقارن لقطة المزوّد بالصفّ المحلي، ويعيد سبب عدم التطابق أو `null`.
 *
 * والمطابقة تُعاد ذرّياً داخل الـRPC أيضاً. وهذه الطبقة ليست تكراراً بلا معنى:
 * هي التي تفرّق «تناقضٌ يحتاج بشراً» عن «فشل RPC عابر» في الرصد، ولولاها
 * لاندرج الاثنان في عدّادٍ واحد.
 */
function describeMismatch(
  row: StalePendingPayment,
  snapshot: { readonly id: string; readonly amount: number; readonly currency: string },
): string | null {
  if (snapshot.id !== row.providerTransactionId) return "PROVIDER_TRANSACTION_MISMATCH";
  if (snapshot.amount !== row.amountMinor) return "AMOUNT_MISMATCH";
  if (snapshot.currency.toUpperCase() !== row.currency.toUpperCase()) return "CURRENCY_MISMATCH";
  return null;
}
