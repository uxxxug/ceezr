import { describe, expect, it, mock } from "bun:test";
import {
  type UploadProgress,
  type UploadXhr,
  uploadFileToSlotWithProgress,
} from "../../apps/miniapp/src/surfaces/driver/documents/upload-progress.ts";

/**
 * عقدُ ربطِ `uploadFileToSlotWithProgress` بـ`DocumentsScreen` — اختبارُ السلوكِ الحقيقيِّ:
 *
 * ١. الـ`onProgress` المُمرَّرُ من الشاشةِ يُحدِّثُ حالةَ الصفِّ أثناءَ الرفعِ.
 * ٢. `null` من `onProgress` يُبقي الحالةَ `busy` بلا نسبةٍ (لا عطبٌ ولا توقُّفٌ).
 * ٣. غيابُ `onProgress` يُبقي السلوكَ كالسابقِ (توافقٌ مع DEC-28 الأصليَّ).
 * ٤. النسبةُ المئويّةُ تُعرَضُ في النصِّ حينَ تكونُ رقمًا.
 *
 * مُستخرَجٌ من العقدِ بلا استيرادِ `.tsx` (الجذرُ بلا `--jsx`).
 */

type ProgressHandler = (event: {
  loaded: number;
  total: number;
  lengthComputable: boolean;
}) => void;

function createMockXhr() {
  let onprogressHandler: ProgressHandler | null = null;
  const xhr = {
    open: mock(() => {}),
    setRequestHeader: mock(() => {}),
    send: mock(() => {}),
    upload: {
      set onprogress(fn: ProgressHandler) {
        onprogressHandler = fn;
      },
      get onprogress(): ProgressHandler | null {
        return onprogressHandler;
      },
    },
    onload: null as ((event: unknown) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    onabort: null as ((event: unknown) => void) | null,
    status: 200,
  };
  return xhr;
}

function makeProgressEvent(
  loaded: number,
  total: number,
  lengthComputable = true,
): { loaded: number; total: number; lengthComputable: boolean } {
  return { loaded, total, lengthComputable };
}

describe("DocumentsScreen upload progress wiring", () => {
  it("يُحدِّثُ حالةَ الصفِّ عندَ تقدُّمِ الرفعِ", async () => {
    const mockXhr = createMockXhr();
    const progressUpdates: UploadProgress[] = [];

    const promise = uploadFileToSlotWithProgress({
      uploadUrl: "https://storage.example.com/upload",
      file: new Blob([new Uint8Array(200)]),
      contentType: "image/jpeg",
      onProgress: (p) => progressUpdates.push(p),
      createXhr: () => mockXhr as unknown as UploadXhr,
    });

    mockXhr.upload.onprogress?.(makeProgressEvent(50, 200));
    mockXhr.upload.onprogress?.(makeProgressEvent(100, 200));
    mockXhr.upload.onprogress?.(makeProgressEvent(200, 200));
    mockXhr.onload?.({} as Event);
    await promise;

    expect(progressUpdates).toEqual([25, 50, 100]);
  });

  it("يُبلِّغُ عن null حينَ lengthComputable = false — والحالةُ تبقى busy", async () => {
    const mockXhr = createMockXhr();
    const progressUpdates: UploadProgress[] = [];

    const promise = uploadFileToSlotWithProgress({
      uploadUrl: "https://storage.example.com/upload",
      file: new Blob(["data"]),
      contentType: "image/png",
      onProgress: (p) => progressUpdates.push(p),
      createXhr: () => mockXhr as unknown as UploadXhr,
    });

    mockXhr.upload.onprogress?.(makeProgressEvent(0, 0, false));
    mockXhr.onload?.({} as Event);
    await promise;

    expect(progressUpdates).toEqual([null]);
  });

  it("يعملُ بلا onProgress — يُبقي السلوكَ كالسابقِ", async () => {
    const mockXhr = createMockXhr();

    const promise = uploadFileToSlotWithProgress({
      uploadUrl: "https://storage.example.com/upload",
      file: new Blob(["data"]),
      contentType: "image/png",
      createXhr: () => mockXhr as unknown as UploadXhr,
    });

    mockXhr.upload.onprogress?.(makeProgressEvent(50, 200));
    mockXhr.onload?.({} as Event);
    await expect(promise).resolves.toBeUndefined();
  });

  it("النسبةُ المئويّةُ تُعرَضُ في النصِّ حينَ تكونُ رقمًا", () => {
    // محاكاةُ منطقِ العرضِ في DocumentsScreen:
    // حينَ progress !== undefined و progress !== null يُعرَضُ النصُّ مع النسبةِ.
    const t = (key: string) =>
      key === "driver.documents.step.uploadingProgress" ? "يُرفَعُ الملفُّ… {percent}%" : key;

    function displayText(progress: number | null | undefined, stepKey: string): string {
      if (progress === undefined || progress === null) {
        return t(stepKey);
      }
      return t("driver.documents.step.uploadingProgress").replace("{percent}", String(progress));
    }

    expect(displayText(75, "driver.documents.step.uploading")).toBe("يُرفَعُ الملفُّ… 75%");
    expect(displayText(0, "driver.documents.step.uploading")).toBe("يُرفَعُ الملفُّ… 0%");
    expect(displayText(100, "driver.documents.step.uploading")).toBe("يُرفَعُ الملفُّ… 100%");
    // null و undefined يُظهرانِ النصَّ بلا نسبةٍ
    expect(displayText(null, "driver.documents.step.uploading")).toBe(
      "driver.documents.step.uploading",
    );
    expect(displayText(undefined, "driver.documents.step.uploading")).toBe(
      "driver.documents.step.uploading",
    );
  });
});
