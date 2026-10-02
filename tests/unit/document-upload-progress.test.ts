import { describe, expect, it, mock } from "bun:test";
import {
  UploadFailedError,
  uploadFileToSlotWithProgress,
} from "../../apps/miniapp/src/surfaces/driver/documents/upload-progress.ts";

/**
 * عقدُ تقدُّمِ رفعِ الوثائقِ (DEC-38) — اختبارُ السلوكِ:
 *
 * ١. `uploadFileToSlotWithProgress` يُبلِّغُ النسبةَ المئويّةَ.
 * ٢. `lengthComputable = false` يُبلِّغُ `null`.
 * ٣. `onProgress` اختياريٌّ — غيابُهُ لا يُكسِرُ.
 * ٤. فشلُ رفعٍ يرفضُ بـ `UploadFailedError`.
 * ٥. `DECLARED_DEBT` في `DocumentsScreen` فارغةٌ.
 */

describe("DEC-38 document upload progress contract", () => {
  it("uploadFileToSlotWithProgress يُبلِّغُ النسبةَ المئويّةَ", async () => {
    const reported: (number | null)[] = [];
    const fakeXhr = {
      open: mock(() => {}),
      setRequestHeader: mock(() => {}),
      send: mock(function (this: unknown, _body: Blob) {
        const self = this as {
          upload: {
            onprogress:
              | ((e: { loaded: number; total: number; lengthComputable: boolean }) => void)
              | null;
          };
          onload: (() => void) | null;
        };
        self.upload.onprogress?.({ loaded: 50, total: 100, lengthComputable: true });
        self.onload?.();
      }),
      status: 200,
      upload: {
        onprogress: null as
          | ((e: { loaded: number; total: number; lengthComputable: boolean }) => void)
          | null,
      },
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
    };

    await uploadFileToSlotWithProgress({
      uploadUrl: "https://example.com/upload",
      file: new Blob(["test"]),
      contentType: "image/png",
      onProgress: (p) => {
        reported.push(p);
      },
      createXhr: () => fakeXhr,
    });

    expect(reported[0]).toBe(50);
  });

  it("lengthComputable = false يُبلِّغُ null", async () => {
    const reported: (number | null)[] = [];
    const fakeXhr = {
      open: mock(() => {}),
      setRequestHeader: mock(() => {}),
      send: mock(function (this: unknown, _body: Blob) {
        const self = this as {
          upload: {
            onprogress:
              | ((e: { loaded: number; total: number; lengthComputable: boolean }) => void)
              | null;
          };
          onload: (() => void) | null;
        };
        self.upload.onprogress?.({ loaded: 50, total: 0, lengthComputable: false });
        self.onload?.();
      }),
      status: 200,
      upload: {
        onprogress: null as
          | ((e: { loaded: number; total: number; lengthComputable: boolean }) => void)
          | null,
      },
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
    };

    await uploadFileToSlotWithProgress({
      uploadUrl: "https://example.com/upload",
      file: new Blob(["test"]),
      contentType: "image/png",
      onProgress: (p) => {
        reported.push(p);
      },
      createXhr: () => fakeXhr,
    });

    expect(reported[0]).toBe(null);
  });

  it("onProgress اختياريٌّ — غيابُهُ لا يُكسِرُ", async () => {
    const fakeXhr = {
      open: mock(() => {}),
      setRequestHeader: mock(() => {}),
      send: mock(function (this: unknown, _body: Blob) {
        const self = this as {
          upload: {
            onprogress:
              | ((e: { loaded: number; total: number; lengthComputable: boolean }) => void)
              | null;
          };
          onload: (() => void) | null;
        };
        self.upload.onprogress?.({ loaded: 50, total: 100, lengthComputable: true });
        self.onload?.();
      }),
      status: 200,
      upload: {
        onprogress: null as
          | ((e: { loaded: number; total: number; lengthComputable: boolean }) => void)
          | null,
      },
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
    };

    await expect(
      uploadFileToSlotWithProgress({
        uploadUrl: "https://example.com/upload",
        file: new Blob(["test"]),
        contentType: "image/png",
        createXhr: () => fakeXhr,
      }),
    ).resolves.toBeUndefined();
  });

  it("فشلُ رفعٍ يرفضُ بـ UploadFailedError", async () => {
    const fakeXhr = {
      open: mock(() => {}),
      setRequestHeader: mock(() => {}),
      send: mock(function (this: unknown, _body: Blob) {
        const self = this as { onload: (() => void) | null };
        self.onload?.();
      }),
      status: 403,
      upload: {
        onprogress: null as
          | ((e: { loaded: number; total: number; lengthComputable: boolean }) => void)
          | null,
      },
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
    };

    await expect(
      uploadFileToSlotWithProgress({
        uploadUrl: "https://example.com/upload",
        file: new Blob(["test"]),
        contentType: "image/png",
        createXhr: () => fakeXhr,
      }),
    ).rejects.toThrow(UploadFailedError);
  });

  it("DECLARED_DEBT في DocumentsScreen فارغةٌ", () => {
    // التحقُّقُ أنَّ الديونَ أُزيلَت من DECLARED_DEBT
    // بقراءةِ مصدرِ الشاشةِ مباشرةً
    const source = require("node:fs").readFileSync(
      "apps/miniapp/src/surfaces/driver/documents/DocumentsScreen.tsx",
      "utf8",
    );
    expect(source).not.toContain("driver.documents.debt.preview");
    expect(source).not.toContain("driver.documents.debt.progress");
  });
});
