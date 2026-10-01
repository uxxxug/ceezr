/**
 * الغرض: رفعُ الملفِّ إلى المخزنِ بتتبُّعِ التقدُّمِ — `XMLHttpRequest` وحدَه
 *   يُعطي `upload.onprogress`. منفصلٌ عن `documents-api.ts` لئلا يُسحَبَ
 *   سلسلةُ الاستيرادِ إلى `tg/` في اختباراتِ الجذرِ (DEC-28 · ADR 0225).
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/documents
 * يُستخدم من: `documents-api.ts` · `tests/unit/upload-progress.test.ts`
 */

/** تقدُّمُ الرفعِ — النسبةُ المئويّةُ من ٠ إلى ١٠٠، أو `null` حينَ `lengthComputable = false`. */
export type UploadProgress = number | null;

/** عطبُ رفعٍ إلى المخزنِ — **صنفٌ مستقلٌّ**: ليسَ عطبَ خادمِنا ولا رفضَ قاعدتِنا. */
export class UploadFailedError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`تعذَّرَ رفعُ الملفِّ إلى المخزنِ (${status})`);
    this.name = "UploadFailedError";
    this.status = status;
  }
}

/** الحدُّ الأدنى من XMLHttpRequest لرفعٍ بتقدُّمٍ — واجهةٌ لا تنفيذٌ. */
export interface UploadXhr {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: Blob): void;
  readonly status: number;
  upload: {
    onprogress:
      | ((event: { loaded: number; total: number; lengthComputable: boolean }) => void)
      | null;
  };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
}

/**
 * الرفعُ المباشرُ بالإذنِ الموقَّعِ مع تتبُّعِ التقدُّمِ — `XMLHttpRequest`
 * وحدَه يُعطي `upload.onprogress`. **لا رمزَ جلسةٍ ولا مفتاحَ خدمةٍ ههنا**.
 * يُفعِّلُ الدَّينَ المُعلَنَ في `documents-contract.ts` (DEC-28).
 *
 * `onProgress` اختياريٌّ — غيابُهُ يُبقي السلوكَ كالسابقِ بلا تغييرٍ.
 * `createXhr` مُحقَنٌ للاختبارِ — في المتصفّحِ يُتركُ غيرَ مُمرَّرٍ فيُستخدَمُ الكوكانيُّ.
 */
export async function uploadFileToSlotWithProgress(input: {
  readonly uploadUrl: string;
  readonly file: Blob;
  readonly contentType: string;
  readonly onProgress?: (progress: UploadProgress) => void;
  readonly createXhr?: () => UploadXhr;
}): Promise<void> {
  const globalThis_typed = globalThis as unknown as { XMLHttpRequest: new () => UploadXhr };
  const xhr: UploadXhr = input.createXhr?.() ?? new globalThis_typed.XMLHttpRequest();

  return new Promise<void>((resolve, reject) => {
    xhr.open("PUT", input.uploadUrl);
    xhr.setRequestHeader("content-type", input.contentType);

    xhr.upload.onprogress = (event: {
      loaded: number;
      total: number;
      lengthComputable: boolean;
    }) => {
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
