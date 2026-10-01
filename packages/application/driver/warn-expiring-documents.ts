/**
 * الغرض: إشعارُ السائقِ باقترابِ انتهاءِ وثائقِهِ قبلَ ثلاثينَ يومًا (DEC-27).
 *   يُفعِّلُ الدَّينَ المُعلَنَ في `driver-documents.ts`: «إشعارٌ يُرسَلُ قبلَ
 *   ثلاثينَ يوماً دَينٌ مُعلَنٌ لا مُنفَّذٌ».
 * الحالة: منفَّذ — البند DEC-27.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: apps/workers/src/jobs/warn-expiring-documents.ts
 * الحاكم: docs/adr/0224-document-expiry-notification.md
 *
 * ## ولِمَ القرارُ هنا لا في القاعدةِ
 *
 * لأنَّ الإرسالَ فعلٌ خارجيٌّ (تلغرام)، والقاعدةُ تُسجِّلُ لا تُرسِلُ. والقرارُ
 * (أُرسِلَ أم لا) يُحفَظُ في `expiry_warning_sent_at` — فلا يتكرَّرُ الإشعارُ.
 */

import { t } from "../../shared/i18n/index.ts";
import type { CityId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

/** وثيقةٌ تنتهي قريبًا — كلُّ ما يلزمُ لإرسالِ رسالةٍ واحدةٍ بلا استعلامٍ إضافيٍّ. */
export interface ExpiringDocument {
  readonly documentId: string;
  readonly driverId: string;
  readonly telegramId: string;
  readonly languageCode: string;
  readonly docType: string;
  readonly expiresAt: string;
  readonly daysLeft: number;
}

/** يُقابلُ `driver_documents_expiring_soon` و `record_document_expiry_warning`. */
export interface DocumentExpiryRpcPort {
  expiringSoon(input: {
    readonly cityId: CityId;
    readonly days: number;
  }): Promise<Result<readonly ExpiringDocument[], PortFailureError>>;
  recordWarning(documentId: string): Promise<Result<void, PortFailureError>>;
}

/** مُرسِلُ الإشعارِ — يُعيدُ نجاحًا أو فشلًا لأنَّ التثبيتَ في القاعدةِ معلَّقٌ عليه. */
export interface DocumentExpiryWarningSender {
  send(input: {
    readonly chatId: string;
    readonly text: string;
  }): Promise<Result<void, PortFailureError>>;
}

export interface WarnExpiringDocumentsDependencies {
  readonly rpc: DocumentExpiryRpcPort;
  readonly sender: DocumentExpiryWarningSender;
  readonly onSendFailure?: (documentId: string, failure: PortFailureError) => void;
}

export interface WarnExpiringDocumentsReport {
  readonly examined: number;
  readonly warned: number;
  readonly failed: readonly string[];
}

const DOCUMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  driving_license: "رخصة القيادة",
  medical_exam: "الفحص الطبي",
  criminal_record: "السجل الجنائي",
  vehicle_registration: "استمارة المركبة",
  insurance: "التأمين",
  periodic_inspection: "الفحص الدوري",
};

function documentLabel(docType: string, languageCode: string): string {
  if (languageCode === "ar") {
    return DOCUMENT_TYPE_LABELS[docType] ?? docType;
  }
  return docType;
}

export async function warnExpiringDocuments(
  input: { readonly cityId: CityId; readonly days: number },
  deps: WarnExpiringDocumentsDependencies,
): Promise<Result<WarnExpiringDocumentsReport, PortFailureError>> {
  const expiring = await deps.rpc.expiringSoon({
    cityId: input.cityId,
    days: input.days,
  });
  if (!expiring.ok) return expiring;

  const documents = expiring.value;
  const failed: string[] = [];

  for (const doc of documents) {
    const tr = t(doc.languageCode);
    const label = documentLabel(doc.docType, doc.languageCode);
    const text = tr("documents.expiry_warning", {
      document: label,
      days: doc.daysLeft,
      expires: doc.expiresAt,
    });

    const sent = await deps.sender.send({
      chatId: doc.telegramId.toString(),
      text,
    });

    if (!sent.ok) {
      deps.onSendFailure?.(doc.documentId, sent.error);
      failed.push(doc.documentId);
      continue;
    }

    const recorded = await deps.rpc.recordWarning(doc.documentId);
    if (!recorded.ok) {
      deps.onSendFailure?.(doc.documentId, recorded.error);
      failed.push(doc.documentId);
    }
  }

  return ok({
    examined: documents.length,
    warned: documents.length - failed.length,
    failed,
  });
}
