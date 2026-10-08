/**
 * الغرض: موضعُ رفعِ الوثيقةِ في خطواتِه **الحقيقيّة** (D8 · UI-4 · §11 PR 7 «خطواتُ رفعِ وثيقةٍ حقيقيّة»).
 * الحالة: منفّذ فعلياً — UI-4 (ADR 0236).
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/documents
 *
 * الخطواتُ الثلاثُ هيَ ما تفعلُه `DocumentsScreen.handleUpload` فعلاً وبترتيبِه: إذنُ رفعٍ
 * موقَّعٌ (`requestUploadSlot`) ← رفعُ الملفِّ إلى المخزن (`uploadFileToSlotWithProgress`)
 * ← تسجيلُ الوثيقةِ في القاعدة (`recordDriverDocument`). لا خطوةَ تُخترَعُ للعرض، والإرسالُ
 * للمراجعةِ فعلٌ مستقلٌّ على اللوحِ كلِّه لا خطوةٌ رابعةٌ لوثيقةٍ واحدة.
 */

export const UPLOAD_STEP_KEYS = [
  "driver.documents.step.signing",
  "driver.documents.step.uploading",
  "driver.documents.step.recording",
] as const;

export type UploadStepKey = (typeof UPLOAD_STEP_KEYS)[number];

export interface UploadStepPosition {
  readonly current: number;
  readonly total: number;
}

/** موضعُ الخطوةِ (يبدأُ من 1)، أو `null` لمفتاحٍ ليسَ خطوةَ رفعٍ — فلا يُرسَمُ مؤشّرٌ كاذب. */
export function uploadStepPosition(stepKey: string): UploadStepPosition | null {
  const index = (UPLOAD_STEP_KEYS as readonly string[]).indexOf(stepKey);
  if (index < 0) return null;
  return { current: index + 1, total: UPLOAD_STEP_KEYS.length };
}

export function uploadStepText(position: UploadStepPosition, t: (key: string) => string): string {
  return t("driver.documents.step.position")
    .replace("{current}", String(position.current))
    .replace("{total}", String(position.total));
}
