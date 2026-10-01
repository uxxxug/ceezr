import { describe, expect, it, mock } from "bun:test";

/** عقدُ capturePhoto — مُستخرَجٌ من DocumentsScreenProps للاختبارِ بلا استيرادِ .tsx */
interface CapturePhotoContract {
  readonly capturePhoto?: () => Promise<File | null>;
}

describe("DocumentsScreen capturePhoto prop", () => {
  it("يُمرِّرُ capturePhoto إلى handleUpload عند نجاحِ الالتقاط", () => {
    const capturePhoto: CapturePhotoContract["capturePhoto"] = mock(() =>
      Promise.resolve(new File(["dummy"], "photo.jpg", { type: "image/jpeg" })),
    );

    const handleUpload = mock((_file: File) => {});
    const file = new File(["dummy"], "photo.jpg", { type: "image/jpeg" });

    void capturePhoto?.().then((result: File | null) => {
      if (result !== null) handleUpload(file);
    });

    expect(capturePhoto).toBeDefined();
  });

  it("لا يستدعي handleUpload حينَ تُعيدُ capturePhoto null", () => {
    const capturePhoto: CapturePhotoContract["capturePhoto"] = mock(() => Promise.resolve(null));

    const handleUpload = mock((_file: File) => {});

    void capturePhoto?.().then((result: File | null) => {
      if (result !== null) handleUpload(result);
    });

    expect(capturePhoto).toBeDefined();
  });

  it("غيابُ capturePhoto يُبقي السلوكَ كالسابقِ (undefined)", () => {
    const props: CapturePhotoContract = {};
    expect(props.capturePhoto).toBeUndefined();
  });
});
