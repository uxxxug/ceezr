/**
 * الغرض: نداءاتُ وثائقِ السائقِ — لوحٌ وخانةُ رفعٍ **ورفعٌ مباشرٌ إلى المخزنِ**
 *   وتسجيلٌ وإرسالٌ للمراجعةِ (البند `F3-01`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/documents
 * يُستخدم من: `DocumentsScreen.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-11` — الرفعُ عينُه بدلوٍ آخرَ.
 *
 * ## لِمَ الرفعُ **لا يمرُّ بـ`apiFetch`**
 *
 * `apiFetch` يُلحِقُ رمزَ جلستِنا بكلِّ طلبٍ ويقرأُ JSON. والرفعُ يذهبُ إلى
 * **مضيفٍ غيرِ مضيفِنا** بإذنٍ موقَّعٍ، فإلحاقُ رمزِ جلسةِ السائقِ به **يُسلِّمُ
 * جلستَه إلى مزوِّدِ تخزينٍ** بلا حاجةٍ. فههنا `fetch` عارٍ برأسِ نوعٍ فحسب.
 *
 * ## وما لا تفعلُه هذه النداءاتُ عن قصدٍ
 *
 *   ــ **لا تُعيدُ المحاولةَ تلقائيّاً**: كلُّ خانةٍ مسارٌ جديدٌ، وإعادةُ رفعٍ
 *      بخانةٍ منتهيةٍ تُقرأُ عطباً؛ والإعادةُ بزرٍّ يفهمُه الإنسانُ.
 *   ــ **لا تقيسُ نوعَ المِلفِّ من امتدادِه**: `file.type` من المنصّةِ، والحكمُ
 *      النهائيُّ للقاعدةِ (`CONTENT_TYPE_NOT_ALLOWED`).
 *   ــ **لا تُسجِّلُ الوثيقةَ تلقائيّاً بعدَ الرفعِ**: التسجيلُ يحتاجُ **تاريخَ
 *      انتهاءٍ** يكتبُه السائقُ، ولا يُخترَعُ له تاريخٌ.
 */

import { apiFetch } from "../../../api/client.ts";
import type {
  ApiDriverDocumentType,
  DriverDocumentsResponse,
  DriverUploadSlotResponse,
  RecordDocumentResponse,
  SubmitDocumentsResponse,
} from "./documents-contract.ts";

export type * from "./documents-contract.ts";

export function readDriverDocuments(): Promise<DriverDocumentsResponse> {
  return apiFetch<DriverDocumentsResponse>("/v1/driver/documents", { method: "GET" });
}

export function requestUploadSlot(input: {
  readonly docType: ApiDriverDocumentType;
  readonly contentType: string;
  readonly sizeBytes: number;
}): Promise<DriverUploadSlotResponse> {
  return apiFetch<DriverUploadSlotResponse>("/v1/driver/documents/upload-url", {
    method: "POST",
    body: {
      doc_type: input.docType,
      content_type: input.contentType,
      size_bytes: input.sizeBytes,
    },
  });
}

export function recordDocument(input: {
  readonly docType: ApiDriverDocumentType;
  readonly objectPath: string;
  readonly expiresAt: string;
}): Promise<RecordDocumentResponse> {
  return apiFetch<RecordDocumentResponse>("/v1/driver/documents", {
    method: "POST",
    body: {
      doc_type: input.docType,
      object_path: input.objectPath,
      expires_at: input.expiresAt,
    },
  });
}

export function submitDocumentsForReview(): Promise<SubmitDocumentsResponse> {
  return apiFetch<SubmitDocumentsResponse>("/v1/driver/documents/submit", { method: "POST" });
}

/** عطبُ رفعٍ إلى المخزنِ — **صنفٌ مستقلٌّ**: ليسَ عطبَ خادمِنا ولا رفضَ قاعدتِنا. */
export class UploadFailedError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`تعذَّرَ رفعُ الملفِّ إلى المخزنِ (${status})`);
    this.name = "UploadFailedError";
    this.status = status;
  }
}

/**
 * الرفعُ المباشرُ بالإذنِ الموقَّعِ. **لا رمزَ جلسةٍ ولا مفتاحَ خدمةٍ ههنا**:
 * الإذنُ في العنوانِ نفسِه، وهذا كلُّ ما يملكُه العميلُ ولا يُحمَلُ إليه سوى
 * البايتِ.
 */
export async function uploadFileToSlot(input: {
  readonly uploadUrl: string;
  readonly file: Blob;
  readonly contentType: string;
}): Promise<void> {
  const response = await fetch(input.uploadUrl, {
    method: "PUT",
    headers: { "content-type": input.contentType },
    body: input.file,
  });
  if (!response.ok) throw new UploadFailedError(response.status);
}

/**
 * تقدُّمُ الرفعِ — النسبةُ المئويّةُ من ٠ إلى ١٠٠.
 * `null` يعني أنَّ المضيفَ لم يُخبرْنا بالحجمِ الكلّيِّ (`lengthComputable = false`).
 */
export type UploadProgress = number | null;

/**
 * الرفعُ المباشرُ بالإذنِ الموقَّعِ مع تتبُّعِ التقدُّمِ — `XMLHttpRequest`
 * وحدَه يُعطي `upload.onprogress`. **لا رمزَ جلسةٍ ولا مفتاحَ خدمةٍ ههنا**.
 * يُفعِّلُ الدَّينَ المُعلَنَ في `documents-contract.ts` (DEC-28).
 *
 * `onProgress` اختياريٌّ — غيابُه يُبقي السلوكَ كالسابقِ بلا تغييرٍ.
 * `createXhr` مُحقَنٌ للاختبارِ — في المتصفّحِ يُتركُ غيرَ مُمرَّرٍ فيُستخدَمُ الكوكانيُّ.
 */
export async function uploadFileToSlotWithProgress(input: {
  readonly uploadUrl: string;
  readonly file: Blob;
  readonly contentType: string;
  readonly onProgress?: (progress: UploadProgress) => void;
  readonly createXhr?: () => XMLHttpRequest;
}): Promise<void> {
  const xhr = input.createXhr?.() ?? new XMLHttpRequest();

  return new Promise<void>((resolve, reject) => {
    xhr.open("PUT", input.uploadUrl);
    xhr.setRequestHeader("content-type", input.contentType);

    xhr.upload.onprogress = (event: ProgressEvent) => {
      if (!input.onProgress) return;
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        input.onProgress(percent);
      } else {
        input.onProgress(null);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new UploadFailedError(xhr.status));
      }
    };

    xhr.onerror = () => {
      reject(new UploadFailedError(0));
    };

    xhr.onabort = () => {
      reject(new UploadFailedError(0));
    };

    xhr.send(input.file);
  });
}
