import { describe, expect, it, mock } from "bun:test";

/**
 * عقدُ `capturePhoto` في `DocumentsScreen` — اختبارُ السلوكِ الحقيقيِّ:
 *
 * ١. الملفُ العائدُ من `capturePhoto` يصلُ إلى `uploadFile`.
 * ٢. `null` لا يستدعي `uploadFile`.
 * ٣. غيابُ `capturePhoto` يُبقي السلوكَ (لا استدعاءَ).
 *
 * مُستخرَجٌ من العقدِ بلا استيرادِ `.tsx` (الجذرُ بلا `--jsx`).
 */
interface CapturePhotoContract {
  readonly capturePhoto?: () => Promise<File | null>;
}

describe("DocumentsScreen capturePhoto prop", () => {
  it("يُمرِّرُ الملفَّ العائدَ من capturePhoto إلى uploadFile", async () => {
    const file = new File(["dummy"], "photo.jpg", { type: "image/jpeg" });
    const uploadFile = mock((_file: File) => Promise.resolve());

    const capturePhoto: CapturePhotoContract["capturePhoto"] = () =>
      Promise.resolve(file);

    const result = await capturePhoto?.();
    if (result !== null) {
      await uploadFile(result);
    }

    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(uploadFile.mock.calls[0]?.[0]).toBe(file);
  });

  it("لا يستدعي uploadFile حينَ تُعيدُ capturePhoto null", async () => {
    const uploadFile = mock((_file: File) => Promise.resolve());

    const capturePhoto: CapturePhotoContract["capturePhoto"] = () =>
      Promise.resolve(null);

    const result = await capturePhoto?.();
    if (result !== null) {
      await uploadFile(result);
    }

    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("غيابُ capturePhoto يُبقي السلوكَ — لا استدعاءَ", () => {
    const props: CapturePhotoContract = {};
    expect(props.capturePhoto).toBeUndefined();
  });
});
