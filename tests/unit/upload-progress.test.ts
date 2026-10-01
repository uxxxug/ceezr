import { describe, expect, it, mock } from "bun:test";
import {
  UploadFailedError,
  type UploadProgress,
  uploadFileToSlotWithProgress,
} from "../../apps/miniapp/src/surfaces/driver/documents/upload-progress.ts";

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

describe("uploadFileToSlotWithProgress", () => {
  it("يُرسِلُ PUT مع content-type الصحيح", async () => {
    const mockXhr = createMockXhr();
    const file = new Blob(["data"], { type: "image/png" });

    const promise = uploadFileToSlotWithProgress({
      uploadUrl: "https://storage.example.com/upload",
      file,
      contentType: "image/png",
      createXhr: () => mockXhr as unknown as never,
    });

    expect(mockXhr.open).toHaveBeenCalledWith("PUT", "https://storage.example.com/upload");
    expect(mockXhr.setRequestHeader).toHaveBeenCalledWith("content-type", "image/png");
    expect(mockXhr.send).toHaveBeenCalledWith(file);

    mockXhr.onload?.({} as Event);
    await promise;
  });

  it("يُبلِّغُ عن التقدُّمِ بالنسبةِ المئويّةِ", async () => {
    const mockXhr = createMockXhr();
    const progress: UploadProgress[] = [];

    const promise = uploadFileToSlotWithProgress({
      uploadUrl: "https://storage.example.com/upload",
      file: new Blob(["data"]),
      contentType: "image/png",
      onProgress: (p) => progress.push(p),
      createXhr: () => mockXhr as unknown as never,
    });

    mockXhr.upload.onprogress?.(makeProgressEvent(50, 200));
    mockXhr.upload.onprogress?.(makeProgressEvent(100, 200));
    mockXhr.upload.onprogress?.(makeProgressEvent(200, 200));
    mockXhr.onload?.({} as Event);
    await promise;

    expect(progress).toEqual([25, 50, 100]);
  });

  it("يُبلِّغُ عن null حينَ lengthComputable = false", async () => {
    const mockXhr = createMockXhr();
    const progress: UploadProgress[] = [];

    const promise = uploadFileToSlotWithProgress({
      uploadUrl: "https://storage.example.com/upload",
      file: new Blob(["data"]),
      contentType: "image/png",
      onProgress: (p) => progress.push(p),
      createXhr: () => mockXhr as unknown as never,
    });

    mockXhr.upload.onprogress?.(makeProgressEvent(0, 0, false));
    mockXhr.onload?.({} as Event);
    await promise;

    expect(progress).toEqual([null]);
  });

  it("يُحلُّ الوعدَ عندَ استجابةٍ 2xx", async () => {
    const mockXhr = createMockXhr();
    mockXhr.status = 200;

    const promise = uploadFileToSlotWithProgress({
      uploadUrl: "https://storage.example.com/upload",
      file: new Blob(["data"]),
      contentType: "image/png",
      createXhr: () => mockXhr as unknown as never,
    });

    mockXhr.onload?.({} as Event);
    await expect(promise).resolves.toBeUndefined();
  });

  it("يَرفُضُ بـ UploadFailedError عندَ استجابةٍ غيرِ 2xx", async () => {
    const mockXhr = createMockXhr();
    mockXhr.status = 403;

    const promise = uploadFileToSlotWithProgress({
      uploadUrl: "https://storage.example.com/upload",
      file: new Blob(["data"]),
      contentType: "image/png",
      createXhr: () => mockXhr as unknown as never,
    });

    mockXhr.onload?.({} as Event);
    await expect(promise).rejects.toThrow(UploadFailedError);
    await expect(promise).rejects.toHaveProperty("status", 403);
  });

  it("يَرفُضُ بـ UploadFailedError عندَ خطأِ شبكةٍ", async () => {
    const mockXhr = createMockXhr();

    const promise = uploadFileToSlotWithProgress({
      uploadUrl: "https://storage.example.com/upload",
      file: new Blob(["data"]),
      contentType: "image/png",
      createXhr: () => mockXhr as unknown as never,
    });

    mockXhr.onerror?.({} as Event);
    await expect(promise).rejects.toThrow(UploadFailedError);
  });

  it("يَرفُضُ بـ UploadFailedError عندَ إلغاءٍ", async () => {
    const mockXhr = createMockXhr();

    const promise = uploadFileToSlotWithProgress({
      uploadUrl: "https://storage.example.com/upload",
      file: new Blob(["data"]),
      contentType: "image/png",
      createXhr: () => mockXhr as unknown as never,
    });

    mockXhr.onabort?.({} as Event);
    await expect(promise).rejects.toThrow(UploadFailedError);
  });

  it("يعملُ بلا onProgress — لا يُبلِّغُ عن شيءٍ", async () => {
    const mockXhr = createMockXhr();

    const promise = uploadFileToSlotWithProgress({
      uploadUrl: "https://storage.example.com/upload",
      file: new Blob(["data"]),
      contentType: "image/png",
      createXhr: () => mockXhr as unknown as never,
    });

    mockXhr.upload.onprogress?.(makeProgressEvent(50, 200));
    mockXhr.onload?.({} as Event);
    await expect(promise).resolves.toBeUndefined();
  });
});
