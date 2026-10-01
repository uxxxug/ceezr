/**
 * الغرض: مهمّةٌ دوريّةٌ تُنبِّهُ السائقينَ باقترابِ انتهاءِ وثائقِهِم (DEC-27).
 * الحالة: منفَّذ — البند DEC-27.
 * ينتمي إلى: apps/workers/src/jobs
 * يُتوقع أن يستخدمه: apps/workers/src/container.ts
 */

import type { WarnExpiringDocumentsReport } from "../../../../packages/application/driver/warn-expiring-documents.ts";
import {
  type WarnExpiringDocumentsDependencies,
  warnExpiringDocuments,
} from "../../../../packages/application/driver/warn-expiring-documents.ts";
import type { CityId } from "../../../../packages/shared/kernel/index.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

export interface WarnExpiringDocumentsInput {
  readonly cityId: CityId;
  readonly days: number;
}

export async function warnExpiringDocumentsJob(
  input: WarnExpiringDocumentsInput,
  deps: WarnExpiringDocumentsDependencies,
): Promise<Result<WarnExpiringDocumentsReport, Error>> {
  const result = await warnExpiringDocuments({ cityId: input.cityId, days: input.days }, deps);
  if (!result.ok) {
    return { ok: false, error: new Error(result.error.detail) };
  }
  return { ok: true, value: result.value };
}
