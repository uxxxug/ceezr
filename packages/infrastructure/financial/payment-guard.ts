/**
 * الغرض: تغليفُ مزوّدِ الدفعِ بقاطعِ دائرةٍ وحدِّ تزامنٍ ومهلةٍ مُعلَنةٍ
 *   (`CAP-006` · `F8-04`)، في **موضعٍ واحدٍ** يرثُه Tap وMoyasar معاً.
 * الحالة: منفّذ فعلياً — المرحلة `F8-04`.
 * ينتمي إلى: infrastructure/financial
 * يُتوقع أن يستخدمه: `payment-provider-factory.ts` وحدَه.
 * ملاحظات مستقبلية: مفتاحُ لا-تكرارٍ (`Idempotency-Key`) موضعُه بندٌ مستقلٌّ —
 *   يُنظر «ما لا يُدَّعى» في ADR 0079.
 *
 * **ولماذا غلافٌ واحدٌ لا حاجزٌ في كلِّ مزوّدٍ؟** لأنَّ الحدَّ يُقاسُ على بوّابةِ
 * الدفعِ الفعّالةِ، وهيَ واحدةٌ في كلِّ تركيبٍ. وحاجزانِ لمزوّدَينِ لا يُشتغَّلُ
 * منهما إلاّ واحدٌ يُعطي سعةً مضاعفةً على الورقِ.
 */

import type {
  ChargeInitiation,
  PaymentProvider,
  ProviderEvent,
  ProviderTransactionSnapshot,
} from "../../application/financial/ports.ts";
import { PortFailureError } from "../../application/ports/index.ts";
import { createDependencyGuard, type DependencyGuard } from "../../shared/resilience/index.ts";
import { err, type Result } from "../../shared/result/index.ts";

/**
 * ردُّ الحاجزِ مُترجَماً إلى رمزِ إخفاقٍ. **والمهلةُ ههنا `INDETERMINATE` لا
 * `FAILED`**: قطعُنا الانتظارَ لا يُثبِتُ أنَّ المالَ لم يتحرَّكْ. ومن سمّاها
 * إخفاقاً دعا مُستدعيَه إلى إعادةِ الشحنِ على معاملةٍ قد تمَّتْ. والحسمُ يقعُ
 * بالويبهوكِ أو بـ`fetchTransaction`، لا بانقضاءِ مؤقّتٍ عندَنا.
 */
function rejectionCode(providerName: string, reason: "open" | "saturated" | "timeout"): string {
  if (reason === "open") return "PAYMENT_CIRCUIT_OPEN";
  if (reason === "saturated") return "PAYMENT_CONCURRENCY_SATURATED";
  return `PAYMENT_TIMEOUT_INDETERMINATE_${providerName.toUpperCase()}`;
}

export interface PaymentGuardOptions {
  /** يُحقَنُ في الاختبارِ بميزانيّةٍ مصغَّرةٍ وساعةٍ مُمرَّرةٍ. */
  readonly guard?: DependencyGuard;
}

/**
 * يُغلِّفُ مزوّدَ الدفعِ. **و`verifyWebhook` لا يُغلَّفُ**: هوَ تحقُّقُ توقيعٍ
 * محلّيٌّ بلا خروجٍ إلى الشبكةِ، وحجبُه بقاطعٍ مفتوحٍ لعطلِ بوّابةٍ كانَ سيُسقِطُ
 * إشعاراتِ دفعٍ **صحيحةً وصلَتْ فعلاً** — أي يُحوِّلُ عطلاً في الصادرِ إلى فقدِ
 * مالٍ مُحصَّلٍ في الوارِدِ.
 */
export function withPaymentGuard(
  inner: PaymentProvider,
  options?: PaymentGuardOptions,
): PaymentProvider {
  const guard = options?.guard ?? createDependencyGuard({ dependency: "payment" });

  const through = async <T>(
    call: () => Promise<Result<T, PortFailureError>>,
  ): Promise<Result<T, PortFailureError>> => {
    const outcome = await guard.run(async () => call(), {
      // إخفاقُ المزوّدِ يعودُ قيمةً لا رمياً، فبلا التصنيفِ كانَ القاطعُ أعمى.
      // **وكلُّ إخفاقٍ ههنا يُعَدُّ**: أرقامُ المزوّدِ تأتي مُدمَجةً في رمزٍ نصّيٍّ
      // واحدٍ، وتمييزُ العابرِ من الدائمِ بمطابقةِ نصٍّ هشٌّ — والأحفظُ أن نُغلِقَ
      // على الإخفاقِ المتكرِّرِ ولو كانَ بعضُه عيبَ نداءٍ عندَنا، لأنَّ المُقابِلَ
      // نداءٌ لا يتوقّفُ على بوّابةِ دفعٍ مُعتَلّةٍ.
      failed: (result: Result<T, PortFailureError>) => !result.ok,
    });
    if (outcome.admitted) return outcome.value;
    return err(
      new PortFailureError(inner.name, rejectionCode(inner.name, outcome.rejection.reason)),
    );
  };

  return {
    name: inner.name,
    async chargeSubscription(
      input: Parameters<PaymentProvider["chargeSubscription"]>[0],
    ): Promise<Result<ChargeInitiation, PortFailureError>> {
      return await through(() => inner.chargeSubscription(input));
    },
    async verifyWebhook(
      rawBody: string,
      headers: Headers,
    ): Promise<Result<ProviderEvent, PortFailureError>> {
      return await inner.verifyWebhook(rawBody, headers);
    },
    async fetchTransaction(
      input: Parameters<PaymentProvider["fetchTransaction"]>[0],
    ): Promise<Result<ProviderTransactionSnapshot, PortFailureError>> {
      return await through(() => inner.fetchTransaction(input));
    },
  };
}
