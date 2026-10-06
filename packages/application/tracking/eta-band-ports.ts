/**
 * الغرض: منفذُ مقياسِ خطأِ تقديرِ الوصول (ADR 0243) — يحفظُ أوّلَ تقديرٍ عُرِضَ لكلِّ ساقٍ
 *   ويُعيدُ إحصاءَ الخطأِ المرصودِ في المدينة، في نداءٍ واحد.
 * الحالة: منفّذ فعلياً — إغلاقُ فجوةِ UI-8 [C] الثانية.
 * ينتمي إلى: packages/application/tracking
 * يُنفِّذُه: packages/infrastructure/tracking/eta-band-store.ts
 */

import type { EtaErrorStats, EtaLeg } from "../../domain/eta/band.ts";
import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export interface EtaBandStore {
  recordAndRead(input: {
    readonly orderId: string;
    readonly leg: EtaLeg;
    readonly predictedSeconds: number;
  }): Promise<Result<EtaErrorStats, PortFailureError>>;
}
