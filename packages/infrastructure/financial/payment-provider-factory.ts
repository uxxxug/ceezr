/**
 * الغرض: اختيار مزوّد الدفع من تركيب التطبيق لا من متغيرات البيئة داخل المحوّل.
 * الحالة: منفّذ فعلياً؛ Tap وMoyasar حقيقيان وmanual مسار دعم بلا ويبهوك مزيّف.
 * ينتمي إلى: infrastructure/financial
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts عند تركيب التبعيات.
 * ملاحظات مستقبلية: التفعيل اليدوي يتم بقرار دعم/إدارة عبر RPC مع سجل تدقيق؛ لا
 *   يقبل هذا المزوّد حدثاً خارجياً ولا يدّعي رابط دفع غير موجود.
 */

import type {
  ChargeInitiation,
  PaymentProvider,
  ProviderEvent,
  ProviderTransactionSnapshot,
} from "../../application/financial/ports.ts";
import { PortFailureError } from "../../application/ports/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import { createMoyasarProvider, type MoyasarProviderOptions } from "./moyasar-provider.ts";
import { withPaymentGuard } from "./payment-guard.ts";
import { createTapProvider, type TapProviderOptions } from "./tap-provider.ts";

export type PaymentProviderName = "tap" | "moyasar" | "manual";
export interface PaymentProviderSecrets {
  readonly moyasar?: MoyasarProviderOptions;
  readonly tap?: TapProviderOptions;
}
export class PaymentProviderFactoryError {
  readonly code = "PAYMENT_PROVIDER_FACTORY_FAILURE" as const;
  constructor(readonly detail: string) {}
}

function manualProvider(): PaymentProvider {
  return {
    name: "manual",
    async chargeSubscription(): Promise<Result<ChargeInitiation, PortFailureError>> {
      return ok({ providerTransactionId: null, checkoutUrl: null, status: "pending" });
    },
    async verifyWebhook(): Promise<Result<ProviderEvent, PortFailureError>> {
      return err(new PortFailureError("manual", "MANUAL_PROVIDER_HAS_NO_WEBHOOK"));
    },
    async fetchTransaction(): Promise<Result<ProviderTransactionSnapshot, PortFailureError>> {
      return err(new PortFailureError("manual", "MANUAL_PROVIDER_REQUIRES_SUPPORT_ACTIVATION"));
    },
  };
}

export function createPaymentProvider(
  name: string,
  secrets: PaymentProviderSecrets,
): Result<PaymentProvider, PaymentProviderFactoryError> {
  if (name === "moyasar") {
    if (secrets.moyasar === undefined) {
      return err(new PaymentProviderFactoryError("MOYASAR_SECRETS_REQUIRED"));
    }
    if (
      secrets.moyasar.secretKey.trim() === "" ||
      secrets.moyasar.webhookSecret.trim() === "" ||
      secrets.moyasar.callbackUrl.trim() === ""
    ) {
      return err(new PaymentProviderFactoryError("MOYASAR_CONFIGURATION_INCOMPLETE"));
    }
    return ok(withPaymentGuard(createMoyasarProvider(secrets.moyasar)));
  }
  if (name === "tap") {
    if (secrets.tap === undefined) {
      return err(new PaymentProviderFactoryError("TAP_SECRETS_REQUIRED"));
    }
    // لا سرّ ويبهوك منفصل عند Tap: التوقيع بالمفتاح السرّي نفسه. فالنقص المحتمل
    // اثنان فقط، وكلاهما يُسقِط التركيب بدل أن يُنتج مزوّداً يفشل عند أول دفعة.
    if (secrets.tap.secretKey.trim() === "" || secrets.tap.redirectUrl.trim() === "") {
      return err(new PaymentProviderFactoryError("TAP_CONFIGURATION_INCOMPLETE"));
    }
    return ok(withPaymentGuard(createTapProvider(secrets.tap)));
  }
  // **`manual` بلا حاجزٍ عن قصدٍ** (`F8-04`): لا خروجَ له إلى شبكةٍ أصلاً، وحاجزٌ
  // حولَ دوالٍّ محلّيّةٍ يُنتِجُ رفضاً بلا اعتماديّةٍ تُحمى.
  if (name === "manual") return ok(manualProvider());
  return err(new PaymentProviderFactoryError("UNKNOWN_PAYMENT_PROVIDER"));
}
